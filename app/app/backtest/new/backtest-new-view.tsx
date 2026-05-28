"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { DayPicker } from "react-day-picker";
import { parseISO } from "date-fns";
import "react-day-picker/style.css";
import "@/components/calendar.css";
import { AppFrame } from "@/components/frame";
import { useT } from "@/components/theme";
import {
  Btn,
  EditorialHeader,
  FlashToast,
  Kicker,
  useFlash,
} from "@/components/atoms";
import { Disclosure } from "@/components/disclosure";
import { MultiSelectPopover } from "@/components/multi-select-popover";
import { useSessionStorage } from "@/components/use-session-storage";
import { Icon } from "@/components/icons";
import { useBreakpoint, PAD, pick } from "@/components/responsive";
import type {
  StrategyStatus,
  BacktestJobPending,
  BacktestJobStatus,
  BacktestResultResponse,
  StrategyResponse,
  DefaultRisk,
} from "@/lib/api/strategies";
import { getAllStocks, type StockResponse } from "@/lib/api/stocks";
import { watchBacktestJob } from "@/lib/api/backtest-watcher";
import { InheritableField } from "@/components/inheritable-field";

export interface StrategyOption {
  id: number;
  name: string;
  status: StrategyStatus;
}

/* ────────── Date + currency helpers ────────── */

// Local-time YYYY-MM-DD (avoids the UTC drift of toISOString in PKT).
function isoLocal(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}
function todayIso(): string {
  return isoLocal(new Date());
}

// Trading-day approximation: PSX trades Mon-Fri minus ~12 holidays/year =>
// ~252 trading days per 365 calendar days. Good enough to drive the live
// scope readout in the rail.
function tradingDaysBetween(startIso: string, endIso: string): number {
  const start = parseISO(startIso).getTime();
  const end = parseISO(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const calendarDays = Math.max(0, Math.round((end - start) / 86400000));
  return Math.round(calendarDays * (252 / 365));
}

function formatPkr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-PK").format(Math.round(n));
}

function compactPkr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("en-PK", { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return `${n}`;
}

/* ────────── Date presets ────────── */

type PresetKey = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "ALL" | "CUSTOM";
const PRESET_ORDER: PresetKey[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "ALL", "CUSTOM"];
const PRESET_LABEL: Record<PresetKey, string> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  YTD: "YTD",
  "1Y": "1Y",
  "3Y": "3Y",
  ALL: "All",
  CUSTOM: "Custom",
};

function presetRange(key: Exclude<PresetKey, "CUSTOM">): { start: string; end: string } {
  const today = new Date();
  const end = isoLocal(today);
  const start = new Date(today);
  switch (key) {
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "YTD":
      start.setMonth(0);
      start.setDate(1);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "3Y":
      start.setFullYear(start.getFullYear() - 3);
      break;
    case "ALL":
      // 10y back is more than the deepest history we expect to have on PSX
      // and stays bounded so the backend isn't asked for forever.
      start.setFullYear(start.getFullYear() - 10);
      break;
  }
  return { start: isoLocal(start), end };
}

function detectActivePreset(startDate: string, endDate: string): PresetKey {
  if (endDate !== todayIso()) return "CUSTOM";
  for (const k of PRESET_ORDER) {
    if (k === "CUSTOM") continue;
    const r = presetRange(k);
    if (r.start === startDate && r.end === endDate) return k;
  }
  return "CUSTOM";
}

function formatPickerLabel(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ────────── Universe ────────── */

// Universe = ((sectors ∩ active) ∪ explicit tickers) ∩ numeric_filters.
// Mirrors the shared resolver in psxDataPortal/backend/app/services/universe.py.
// All three slots are independent and always visible — there's no longer a
// "mode" toggle that hides one against another. Empty + empty + no filters
// falls back to "all active" via the backend default.

interface NumericFilters {
  min_price: number | null;
  max_price: number | null;
  min_volume: number | null;
  min_market_cap: number | null;
}

const EMPTY_FILTERS: NumericFilters = {
  min_price: null,
  max_price: null,
  min_volume: null,
  min_market_cap: null,
};

interface RiskCaps {
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  trailing_stop_pct: number | null;
  max_holding_days: number | null;
  max_positions: number | null;
}

const RISK_DEFAULTS: RiskCaps = {
  stop_loss_pct: 5,
  take_profit_pct: null,
  trailing_stop_pct: null,
  max_holding_days: null,
  max_positions: 5,
};

const RISK_NONE: RiskCaps = {
  stop_loss_pct: null,
  take_profit_pct: null,
  trailing_stop_pct: null,
  max_holding_days: null,
  max_positions: null,
};

const RISK_AGGRESSIVE: RiskCaps = {
  stop_loss_pct: 8,
  take_profit_pct: 20,
  trailing_stop_pct: null,
  max_holding_days: null,
  max_positions: 8,
};

function risksEqual(a: RiskCaps, b: RiskCaps): boolean {
  return (
    a.stop_loss_pct === b.stop_loss_pct &&
    a.take_profit_pct === b.take_profit_pct &&
    a.trailing_stop_pct === b.trailing_stop_pct &&
    a.max_holding_days === b.max_holding_days &&
    a.max_positions === b.max_positions
  );
}

function activeRiskCount(r: RiskCaps): number {
  return [r.stop_loss_pct, r.take_profit_pct, r.trailing_stop_pct, r.max_holding_days, r.max_positions]
    .filter((v) => v != null)
    .length;
}

function activeFilterCount(f: NumericFilters): number {
  return [f.min_price, f.max_price, f.min_volume, f.min_market_cap]
    .filter((v) => v != null)
    .length;
}

/* ────────── View ────────── */

export function BacktestNewView({
  strategies,
  initialStrategyId,
  initialStart,
  initialEnd,
}: {
  strategies: StrategyOption[];
  initialStrategyId: number | null;
  initialStart: string | null;
  initialEnd: string | null;
}) {
  const T = useT();
  const router = useRouter();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  const { flash, setFlash } = useFlash();

  // If the URL ships a strategy_id that's not in the user's list (deleted,
  // wrong tenant, etc.), fall back to no selection so the picker shows.
  const pickedStrategyExists =
    initialStrategyId != null &&
    strategies.some((s) => s.id === initialStrategyId);
  const [strategyId, setStrategyId] = useState<number | null>(
    pickedStrategyExists ? initialStrategyId : null,
  );

  // Default range is now 1Y (was 1M). 1M is too short to be a meaningful
  // backtest — the rail's trading-days readout makes the cost of a longer
  // range obvious, so a sensible default is the right move.
  const defaultRange = presetRange("1Y");
  const [startDate, setStartDate] = useState<string>(initialStart ?? defaultRange.start);
  const [endDate, setEndDate] = useState<string>(initialEnd ?? defaultRange.end);
  const [initialCapital, setInitialCapital] = useState<number>(1_000_000);

  // Universe scope (2026-05-11): required pick before submission. ``null``
  // means "user hasn't decided yet" — the run button stays disabled and the
  // sector/ticker inputs stay hidden until they pick one. Closes the
  // accidental "all stocks" bug where forgetting to pick a sector silently
  // backtested against every active stock on PSX.
  const [universeScope, setUniverseScope] = useState<
    "all_active" | "by_sector" | "by_ticker" | "by_sector_and_ticker" | null
  >(null);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [numericFilters, setNumericFilters] = useState<NumericFilters>(EMPTY_FILTERS);
  const [riskCaps, setRiskCaps] = useState<RiskCaps>(RISK_DEFAULTS);
  // Hybrid exits (Option C): when the selected strategy authored
  // `exit_rules.default_risk`, the four inheritable risk fields render via
  // InheritableField — ghost when null, overridden when the user types.
  // See `docs/EXITS_IMPLEMENTATION_PLAN.md` Phase 5.
  const [strategyDefaults, setStrategyDefaults] = useState<DefaultRisk | null>(null);

  const [running, setRunning] = useState(false);

  const selectedStrategy = strategies.find((s) => s.id === strategyId) ?? null;

  // Pull the selected strategy's default_risk on selection. Failures here
  // are non-fatal — the form falls back to no-default behavior, so the user
  // can still run the backtest with their own risk caps.
  useEffect(() => {
    if (!strategyId) {
      setStrategyDefaults(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/strategies/${strategyId}`);
        if (!res.ok || cancelled) return;
        const s = (await res.json()) as StrategyResponse;
        const dr = s.exit_rules?.default_risk ?? null;
        if (cancelled) return;
        setStrategyDefaults(dr);
        // Anchor-counter: where the strategy authored a default, clear the
        // form's override so the field starts in ghost / inherit. Fields with
        // no strategy default keep their current value (typically the
        // RISK_DEFAULTS preset). max_positions isn't inheritable.
        if (dr) {
          setRiskCaps((cur) => ({
            stop_loss_pct: dr.stop_loss_pct != null ? null : cur.stop_loss_pct,
            take_profit_pct: dr.take_profit_pct != null ? null : cur.take_profit_pct,
            trailing_stop_pct: dr.trailing_stop_pct != null ? null : cur.trailing_stop_pct,
            max_holding_days: dr.max_holding_days != null ? null : cur.max_holding_days,
            max_positions: cur.max_positions,
          }));
        }
      } catch {
        // swallow
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  // PSX universe — fetched once on mount, used for sector + symbol pickers.
  const [stocks, setStocks] = useState<StockResponse[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await getAllStocks().catch(() => []);
      if (!cancelled) setStocks(all);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    for (const s of stocks) {
      if (s.sector_name && s.is_active) set.add(s.sector_name);
    }
    return Array.from(set).sort();
  }, [stocks]);
  const availableSymbols = useMemo(
    () =>
      stocks
        .filter((s) => s.is_active)
        .map((s) => ({ symbol: s.symbol, name: s.name }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [stocks],
  );
  const totalActive = availableSymbols.length;

  // Live universe size = |((sectors ∩ active) ∪ explicit_tickers)|.
  // Numeric filters (price/volume/cap) apply on the backend at run time so
  // they're not reflected client-side — the rail surfaces filter count as
  // a sub-line instead. With both sectors and tickers empty we surface the
  // resolver's "all active" default so the user sees the real run scope.
  const universeSize = useMemo(() => {
    // 2026-05-11: scope is the first switch. ``null`` ⇒ user hasn't
    // picked yet, return 0 so the rail's Run button stays disabled.
    if (universeScope === null) return 0;
    const active = stocks.filter((s) => s.is_active);
    if (universeScope === "all_active") return active.length;

    // Helper: count active stocks in selectedSectors.
    const sectorCount = (): number => {
      if (selectedSectors.length === 0) return 0;
      const sectorSet = new Set(selectedSectors);
      let count = 0;
      for (const s of active) {
        if (s.sector_name && sectorSet.has(s.sector_name)) count += 1;
      }
      return count;
    };

    // Helper: count any stock matching selectedTickers (delisted allowed).
    const tickerCount = (): number => {
      if (selectedTickers.length === 0) return 0;
      const tickerSet = new Set(selectedTickers.map((s) => s.toUpperCase()));
      let count = 0;
      for (const s of stocks) {
        if (tickerSet.has(s.symbol.toUpperCase())) count += 1;
      }
      return count;
    };

    if (universeScope === "by_sector") return sectorCount();
    if (universeScope === "by_ticker") return tickerCount();

    // by_sector_and_ticker — union of the two branches, deduped by symbol.
    if (universeScope === "by_sector_and_ticker") {
      const sectorSet = new Set(selectedSectors);
      const tickerSet = new Set(selectedTickers.map((s) => s.toUpperCase()));
      const union = new Set<string>();
      for (const s of active) {
        if (s.sector_name && sectorSet.has(s.sector_name)) union.add(s.symbol);
      }
      for (const s of stocks) {
        if (tickerSet.has(s.symbol.toUpperCase())) union.add(s.symbol);
      }
      return union.size;
    }
    return 0;
  }, [stocks, universeScope, selectedSectors, selectedTickers]);

  const tradingDays = useMemo(
    () => tradingDaysBetween(startDate, endDate),
    [startDate, endDate],
  );

  /* ────────── Run ────────── */

  async function handleRun() {
    if (running) return;
    if (!strategyId) {
      setFlash("Pick a strategy before running.");
      return;
    }
    if (!startDate || !endDate) {
      setFlash("Pick a from / to date range before running.");
      return;
    }
    if (startDate >= endDate) {
      setFlash("From date must be before to date.");
      return;
    }
    if (endDate > todayIso()) {
      setFlash("To date cannot be in the future.");
      return;
    }
    const minSpanMs = 7 * 24 * 60 * 60 * 1000;
    if (new Date(endDate).getTime() - new Date(startDate).getTime() < minSpanMs) {
      setFlash("Date range must span at least 7 days.");
      return;
    }
    if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
      setFlash("Initial capital must be greater than zero.");
      return;
    }
    // Universe-scope guard (2026-05-11). The backend validator rejects
    // any inconsistent (scope, filters, symbols) combination with 422,
    // so we mirror the same rules client-side to surface the error
    // inline rather than as a network bounce.
    if (universeScope === null) {
      setFlash("Pick a universe scope before running.");
      return;
    }
    if (universeScope === "by_sector" && selectedSectors.length === 0) {
      setFlash("Pick at least one sector for the 'by sector' scope.");
      return;
    }
    if (universeScope === "by_ticker" && selectedTickers.length === 0) {
      setFlash("Add at least one ticker for the 'by ticker' scope.");
      return;
    }
    if (universeScope === "by_sector_and_ticker") {
      if (selectedSectors.length === 0) {
        setFlash("Pick at least one sector for the composite scope.");
        return;
      }
      if (selectedTickers.length === 0) {
        setFlash("Add at least one ticker for the composite scope.");
        return;
      }
    }

    // Build the universe payload to match the chosen scope. Fields
    // forbidden by the scope are sent as null so a leftover entry from
    // a previous scope choice can't sneak through.
    const numericFiltersActive =
      numericFilters.min_price != null ||
      numericFilters.max_price != null ||
      numericFilters.min_volume != null ||
      numericFilters.min_market_cap != null;
    let payloadFilters: Record<string, unknown> | null = null;
    let payloadSymbols: string[] | null = null;
    if (universeScope === "by_sector") {
      payloadFilters = {
        sectors: selectedSectors,
        ...numericFilters,
      };
    } else if (universeScope === "all_active") {
      payloadFilters = numericFiltersActive ? { ...numericFilters } : null;
    } else if (universeScope === "by_sector_and_ticker") {
      // Composite: sectors + numeric filters on one side, explicit
      // tickers on the other. Backend's resolve_universe_by_scope
      // applies the numeric filters to the sector branch only.
      payloadFilters = { sectors: selectedSectors, ...numericFilters };
      payloadSymbols = selectedTickers;
    } else {
      // by_ticker — explicit allowlist, no numeric thresholds.
      payloadSymbols = selectedTickers;
    }

    setRunning(true);
    try {
      const startRes = await fetch(`/api/strategies/${strategyId}/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          initial_capital: initialCapital,
          universe_scope: universeScope,
          stock_filters: payloadFilters,
          stock_symbols: payloadSymbols,
          stop_loss_pct: riskCaps.stop_loss_pct,
          take_profit_pct: riskCaps.take_profit_pct,
          trailing_stop_pct: riskCaps.trailing_stop_pct,
          max_holding_days: riskCaps.max_holding_days,
          max_positions: riskCaps.max_positions,
        }),
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        if (startRes.status === 403) throw new Error("Backtests require the Pro plan.");
        throw new Error(
          typeof err?.error === "string" ? err.error : `Start failed (${startRes.status})`,
        );
      }
      const started = (await startRes.json()) as
        | BacktestJobPending
        | BacktestResultResponse;

      // Sync mode (Redis off): backend returns the full result inline.
      if (!("job_id" in started)) {
        router.push(`/backtest?strategy_id=${strategyId}&backtest_id=${started.id}`);
        return;
      }

      const final = await watchBacktestJob(strategyId, started.job_id);
      if (final.status === "failed") {
        throw new Error(final.error ?? "Backtest failed");
      }
      if (final.backtest_id) {
        router.push(`/backtest?strategy_id=${strategyId}&backtest_id=${final.backtest_id}`);
      } else {
        // Shouldn't happen — completed without a backtest_id. Fall back to
        // the per-strategy results page which auto-loads the latest run.
        router.push(`/backtest?strategy_id=${strategyId}`);
      }
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Backtest failed");
      setRunning(false);
    }
  }

  const empty = strategies.length === 0;

  /* ────────── Layout ────────── */

  const usingDefaultRange =
    detectActivePreset(startDate, endDate) === "1Y" && !initialStart;
  const usingDefaultCapital = initialCapital === 1_000_000;
  const usingDefaultRisk = risksEqual(riskCaps, RISK_DEFAULTS);
  // "Default" universe = nothing picked, no filters → resolver falls back
  // to all active. Keeps the rail's "· default" hint accurate.
  const usingDefaultUniverse =
    selectedSectors.length === 0 &&
    selectedTickers.length === 0 &&
    activeFilterCount(numericFilters) === 0;

  return (
    <AppFrame route="/backtest">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <EditorialHeader
          kicker={
            <>
              <Link href="/backtest" style={{ color: T.primaryLight }}>
                Backtest
              </Link>{" "}
              / <span style={{ color: T.text2 }}>new run</span>
            </>
          }
          title={
            <>
              <span style={{ fontWeight: 400, color: T.text2 }}>Run a</span>{" "}
              <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>
                backtest
              </span>
            </>
          }
          meta={
            empty ? (
              <span>no strategies yet — build one to backtest it</span>
            ) : selectedStrategy ? (
              <>
                <span>{selectedStrategy.name}</span>
                <span style={{ color: T.text3 }}>
                  scope updates as you change the form — review on the right, then run
                </span>
              </>
            ) : (
              <span>pick a strategy, set the scope, then run</span>
            )
          }
          actions={
            <Link href="/backtest" style={{ textDecoration: "none" }}>
              <Btn variant="ghost" size="sm">
                Cancel
              </Btn>
            </Link>
          }
        />

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: pick(bp, {
              mobile: `20px ${padX} 28px`,
              desktop: `28px ${padX} 40px`,
            }),
            scrollPaddingBottom: 96,
          }}
        >
          {empty ? (
            <EmptyState />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: pick(bp, {
                  mobile: "minmax(0, 1fr)",
                  tablet: "minmax(0, 1fr)",
                  desktop: "minmax(0, 1.9fr) minmax(280px, 1fr)",
                }),
                gap: pick(bp, { mobile: 28, desktop: 56 }),
                alignItems: "start",
              }}
            >
              {/* ── form column ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 32, minWidth: 0 }}>
                <StrategySection
                  strategies={strategies}
                  value={strategyId}
                  onChange={setStrategyId}
                  disabled={running}
                />

                <RangeSection
                  startDate={startDate}
                  endDate={endDate}
                  onStart={setStartDate}
                  onEnd={setEndDate}
                  disabled={running}
                />

                <CapitalSection
                  value={initialCapital}
                  onChange={setInitialCapital}
                  disabled={running}
                />

                <UniverseSection
                  scope={universeScope}
                  onScope={(next) => {
                    setUniverseScope(next);
                    // Drop fields the new scope doesn't allow so a stale
                    // sector / ticker / numeric value can't sneak through
                    // on submit. by_sector_and_ticker (2026-05-12) keeps
                    // both sectors and tickers so the user can flip in/out
                    // of the composite mode without losing their picks.
                    if (next === "all_active") {
                      setSelectedSectors([]);
                      setSelectedTickers([]);
                    } else if (next === "by_sector") {
                      setSelectedTickers([]);
                    } else if (next === "by_ticker") {
                      setSelectedSectors([]);
                      setNumericFilters(EMPTY_FILTERS);
                    }
                    // by_sector_and_ticker: keep both sectors and tickers;
                    // numeric filters stay too (applied to sector branch).
                  }}
                  sectors={selectedSectors}
                  onSectors={setSelectedSectors}
                  tickers={selectedTickers}
                  onTickers={setSelectedTickers}
                  filters={numericFilters}
                  onFilters={setNumericFilters}
                  availableSectors={availableSectors}
                  availableSymbols={availableSymbols}
                  totalActive={totalActive}
                  disabled={running}
                />

                <RiskSection
                  value={riskCaps}
                  onChange={setRiskCaps}
                  disabled={running}
                  strategyDefaults={strategyDefaults}
                />

                {/* Mobile-only run row sits at the bottom of the form. On
                    desktop the rail's CTA is the primary action. */}
                {isMobile && (
                  <div className="psx-mobile-cta-bar">
                    <Btn
                      variant="primary"
                      size="md"
                      icon={Icon.spark}
                      onClick={handleRun}
                      disabled={running || !strategyId || universeScope === null}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      {running ? "Running…" : "Run backtest"}
                    </Btn>
                  </div>
                )}
              </div>

              {/* ── rail ── */}
              {!isMobile && (
                <RunRail
                  strategy={selectedStrategy}
                  startDate={startDate}
                  endDate={endDate}
                  tradingDays={tradingDays}
                  rangeIsDefault={usingDefaultRange}
                  capital={initialCapital}
                  capitalIsDefault={usingDefaultCapital}
                  universeSize={universeSize}
                  totalActive={totalActive}
                  selectedSectorsCount={selectedSectors.length}
                  selectedTickersCount={selectedTickers.length}
                  filtersActive={activeFilterCount(numericFilters)}
                  universeIsDefault={usingDefaultUniverse}
                  risk={riskCaps}
                  strategyDefaults={strategyDefaults}
                  riskIsDefault={usingDefaultRisk}
                  running={running}
                  onRun={handleRun}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {flash && <FlashToast message={flash} />}
    </AppFrame>
  );
}

/* ────────── Empty state ────────── */

function EmptyState() {
  const T = useT();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 14,
        padding: "32px 0",
        maxWidth: 560,
      }}
    >
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 12,
          color: T.text3,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        nothing to backtest yet
      </div>
      <div style={{ fontSize: 15, color: T.text2, lineHeight: 1.55 }}>
        Backtests run against strategies — the entry/exit rules you author over on{" "}
        <Link href="/strategies" style={{ color: T.primaryLight }}>
          Strategies
        </Link>
        . Build one first, then come back here to validate it against historical PSX data.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Link href="/strategies/new" style={{ textDecoration: "none" }}>
          <Btn variant="primary" size="sm" icon={Icon.plus}>
            Build a strategy
          </Btn>
        </Link>
      </div>
    </div>
  );
}

/* ────────── Sticky run rail ────────── */

function RunRail({
  strategy,
  startDate,
  endDate,
  tradingDays,
  rangeIsDefault,
  capital,
  capitalIsDefault,
  universeSize,
  totalActive,
  selectedSectorsCount,
  selectedTickersCount,
  filtersActive,
  universeIsDefault,
  risk,
  strategyDefaults,
  riskIsDefault,
  running,
  onRun,
}: {
  strategy: StrategyOption | null;
  startDate: string;
  endDate: string;
  tradingDays: number;
  rangeIsDefault: boolean;
  capital: number;
  capitalIsDefault: boolean;
  universeSize: number;
  totalActive: number;
  selectedSectorsCount: number;
  selectedTickersCount: number;
  filtersActive: number;
  universeIsDefault: boolean;
  risk: RiskCaps;
  strategyDefaults: DefaultRisk | null;
  riskIsDefault: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const T = useT();
  const rangeLabel = `${formatPickerLabel(startDate)} → ${formatPickerLabel(endDate)}`;
  const universeLabel = (() => {
    const noSectors = selectedSectorsCount === 0;
    const noTickers = selectedTickersCount === 0;
    if (noSectors && noTickers) {
      return `All active · ${totalActive.toLocaleString("en-PK")} tickers`;
    }
    const parts: string[] = [];
    if (selectedSectorsCount > 0) {
      parts.push(`${selectedSectorsCount} sector${selectedSectorsCount === 1 ? "" : "s"}`);
    }
    if (selectedTickersCount > 0) {
      parts.push(`${selectedTickersCount} ticker${selectedTickersCount === 1 ? "" : "s"}`);
    }
    return `${parts.join(" ∪ ")} · ${universeSize.toLocaleString("en-PK")} tickers`;
  })();
  const riskLabel = (() => {
    // Mirror backend resolver: override (risk.X) wins, else strategy default,
    // else absent. Inherited values get a "↳" prefix so the rail communicates
    // both the effective cap and that it came from the strategy.
    const parts: string[] = [];
    const stop = risk.stop_loss_pct ?? strategyDefaults?.stop_loss_pct ?? null;
    if (stop != null) {
      const tag = risk.stop_loss_pct == null && strategyDefaults?.stop_loss_pct != null ? "↳ " : "";
      parts.push(`${tag}Stop ${stop}%`);
    }
    const take = risk.take_profit_pct ?? strategyDefaults?.take_profit_pct ?? null;
    if (take != null) {
      const tag = risk.take_profit_pct == null && strategyDefaults?.take_profit_pct != null ? "↳ " : "";
      parts.push(`${tag}Take ${take}%`);
    }
    const trail = risk.trailing_stop_pct ?? strategyDefaults?.trailing_stop_pct ?? null;
    if (trail != null) {
      const tag = risk.trailing_stop_pct == null && strategyDefaults?.trailing_stop_pct != null ? "↳ " : "";
      parts.push(`${tag}Trail ${trail}%`);
    }
    if (risk.max_positions != null) parts.push(`Max ${risk.max_positions} pos`);
    const hold = risk.max_holding_days ?? strategyDefaults?.max_holding_days ?? null;
    if (hold != null) {
      const tag = risk.max_holding_days == null && strategyDefaults?.max_holding_days != null ? "↳ " : "";
      parts.push(`${tag}${hold}d max`);
    }
    if (parts.length === 0) return "no caps applied";
    return parts.join(" · ");
  })();

  const candidateSignals = tradingDays * Math.max(universeSize, 0);
  const canRun = strategy != null && tradingDays > 0 && universeSize > 0 && !running;

  return (
    <aside
      className="psx-sticky-rail"
      aria-label="Backtest run summary"
      style={{
        background: T.surface2,
        borderRadius: 10,
        boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 16px 40px -24px rgba(0,0,0,0.45)`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "16px 20px 14px",
          borderBottom: `1px solid ${T.outlineFaint}`,
        }}
      >
        <Kicker>run summary</Kicker>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: T.fontHead,
              fontSize: 22,
              fontWeight: 400,
              fontStyle: strategy ? "italic" : "normal",
              color: strategy ? T.text : T.text3,
              lineHeight: 1.1,
            }}
          >
            {strategy ? strategy.name : "— pick a strategy"}
          </span>
          {strategy && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 9.5,
                color: statusColor(strategy.status, T),
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              {strategy.status.toLowerCase()}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "14px 20px 4px", display: "flex", flexDirection: "column", gap: 14 }}>
        <SummaryCell
          label="scope"
          value={`${rangeLabel}`}
          sub={`${tradingDays.toLocaleString("en-PK")} trading days`}
          isDefault={rangeIsDefault}
        />
        <SummaryCell
          label="capital"
          value={`Rs ${formatPkr(capital)}`}
          isDefault={capitalIsDefault}
        />
        <SummaryCell
          label="universe"
          value={universeLabel}
          sub={
            universeIsDefault
              ? undefined
              : filtersActive > 0
                ? `${filtersActive} filter${filtersActive === 1 ? "" : "s"} applied`
                : undefined
          }
          isDefault={universeIsDefault}
        />
        <SummaryCell label="risk caps" value={riskLabel} isDefault={riskIsDefault} />

        {candidateSignals > 0 && (
          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              background: T.surface,
              borderRadius: 6,
              boxShadow: `0 0 0 1px ${T.outlineFaint}`,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 9.5,
                color: T.text3,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              estimated scope
            </span>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 13,
                color: T.text,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ~{candidateSignals.toLocaleString("en-PK")} candidate decisions
            </span>
            <span
              style={{
                fontFamily: T.fontSans,
                fontSize: 11,
                color: T.text3,
                lineHeight: 1.45,
              }}
            >
              {tradingDays.toLocaleString("en-PK")} trading days × {universeSize.toLocaleString("en-PK")}{" "}
              tickers — actual signals depend on your strategy rules.
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "12px 20px 20px",
          marginTop: "auto",
        }}
      >
        <Btn
          variant="primary"
          size="lg"
          icon={Icon.spark}
          onClick={onRun}
          disabled={!canRun}
          style={{
            width: "100%",
            justifyContent: "center",
            fontSize: 14,
            padding: "12px 18px",
          }}
        >
          {running ? "Running…" : "Run backtest"}
        </Btn>
        {!strategy && (
          <div
            style={{
              marginTop: 8,
              fontFamily: T.fontMono,
              fontSize: 10.5,
              color: T.text3,
              textAlign: "center",
              letterSpacing: 0.4,
            }}
          >
            pick a strategy on the left to enable
          </div>
        )}
      </div>
    </aside>
  );
}

function statusColor(status: StrategyStatus, T: ReturnType<typeof useT>): string {
  if (status === "ACTIVE") return T.deploy;
  if (status === "PAUSED") return T.warning;
  if (status === "ARCHIVED") return T.text3;
  return T.text3;
}

// One row in the rail. The `key` bump on value change restarts the
// `psx-cell-flash` keyframe — the cell does an opacity+translate fade-in,
// adjacent cells stay still. Reads as "this just updated."
function SummaryCell({
  label,
  value,
  sub,
  isDefault,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  isDefault?: boolean;
}) {
  const T = useT();
  return (
    <div
      key={typeof value === "string" ? value : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        animation: "psx-cell-flash 180ms ease-out",
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          color: T.text3,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          display: "flex",
          gap: 6,
          alignItems: "baseline",
        }}
      >
        {label}
        {isDefault && (
          <span style={{ color: T.text3, opacity: 0.7, letterSpacing: 0.4 }}>· default</span>
        )}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 13,
          color: T.text,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.4,
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontFamily: T.fontSans, fontSize: 11, color: T.text3, lineHeight: 1.4 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

/* ────────── Strategy section ────────── */

function StrategySection({
  strategies,
  value,
  onChange,
  disabled,
}: {
  strategies: StrategyOption[];
  value: number | null;
  onChange: (id: number) => void;
  disabled: boolean;
}) {
  const T = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // ACTIVE first, then PAUSED, then DRAFT, then ARCHIVED.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = strategies.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const order: Record<StrategyStatus, number> = {
      ACTIVE: 0,
      PAUSED: 1,
      DRAFT: 2,
      ARCHIVED: 3,
    };
    filtered.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    return filtered;
  }, [strategies, query]);

  const selected = strategies.find((s) => s.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <Section
      label="strategy"
      hint="The entry/exit rules this run will use. Draft strategies can be backtested too."
    >
      <div ref={wrapRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            width: "100%",
            maxWidth: 480,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            background: T.surface,
            color: selected ? T.text : T.text3,
            border: "none",
            boxShadow: `0 0 0 1px ${T.outlineFaint}`,
            borderRadius: 8,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
            fontFamily: T.fontSans,
            fontSize: 13.5,
          }}
        >
          {selected ? (
            <span style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
              <span
                style={{
                  fontStyle: "italic",
                  fontFamily: T.fontHead,
                  fontWeight: 400,
                  color: T.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selected.name}
              </span>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 9.5,
                  color: statusColor(selected.status, T),
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                {selected.status.toLowerCase()}
              </span>
            </span>
          ) : (
            <span>Pick a strategy…</span>
          )}
          <span aria-hidden style={{ color: T.text3, lineHeight: 0 }}>
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 4.5 L6 8 L10 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>

        {open && (
          <div
            role="listbox"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 50,
              width: "min(480px, 100%)",
              background: T.surface2,
              borderRadius: 10,
              boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 16px 40px -12px rgba(0,0,0,0.45)`,
              animation: "psx-pop-in 140ms ease-out",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxHeight: 360,
            }}
          >
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.outlineFaint}` }}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder="search strategies…"
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: T.text,
                  fontFamily: T.fontMono,
                  fontSize: 12.5,
                }}
              />
            </div>
            <div style={{ overflowY: "auto", padding: "4px 0" }}>
              {visible.length === 0 ? (
                <div
                  style={{
                    padding: "12px 14px",
                    fontFamily: T.fontMono,
                    fontSize: 11,
                    color: T.text3,
                  }}
                >
                  no matches
                </div>
              ) : (
                visible.map((s) => {
                  const active = s.id === value;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(s.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      style={{
                        appearance: "none",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 14px",
                        background: active ? T.surface3 : "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 12,
                        color: T.text,
                        fontFamily: T.fontSans,
                        fontSize: 13,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.name}
                      </span>
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 9.5,
                          color: statusColor(s.status, T),
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                          flexShrink: 0,
                        }}
                      >
                        {s.status.toLowerCase()}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ────────── Range section ────────── */

function RangeSection({
  startDate,
  endDate,
  onStart,
  onEnd,
  disabled,
}: {
  startDate: string;
  endDate: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  disabled: boolean;
}) {
  const T = useT();
  const [customSticky, setCustomSticky] = useState(
    () => detectActivePreset(startDate, endDate) === "CUSTOM",
  );
  const detected = detectActivePreset(startDate, endDate);
  const active: PresetKey = customSticky ? "CUSTOM" : detected;

  const handlePresetClick = (key: PresetKey) => {
    if (disabled) return;
    if (key === "CUSTOM") {
      setCustomSticky(true);
      return;
    }
    setCustomSticky(false);
    const r = presetRange(key);
    onStart(r.start);
    onEnd(r.end);
  };

  const chipStyle = (isActive: boolean): CSSProperties => ({
    background: isActive ? T.surface3 : "transparent",
    color: isActive ? T.text : T.text2,
    border: `1px solid ${isActive ? T.outlineVariant : T.outlineFaint}`,
    borderRadius: 3,
    padding: "5px 11px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: T.fontMono,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
  });

  return (
    <Section label="date range" hint="The historical window the strategy will be simulated over.">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PRESET_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => handlePresetClick(k)}
              disabled={disabled}
              style={chipStyle(active === k)}
            >
              {PRESET_LABEL[k]}
            </button>
          ))}
        </div>
        {active === "CUSTOM" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4 }}>
            <DateTrigger
              label="from"
              iso={startDate}
              onChange={onStart}
              disabledAfter={endDate}
            />
            <span style={{ color: T.text3 }}>→</span>
            <DateTrigger
              label="to"
              iso={endDate}
              onChange={onEnd}
              disabledBefore={startDate}
              disabledAfter={todayIso()}
            />
          </div>
        )}
      </div>
    </Section>
  );
}

function DateTrigger({
  label,
  iso,
  onChange,
  disabledBefore,
  disabledAfter,
}: {
  label: string;
  iso: string;
  onChange: (v: string) => void;
  disabledBefore?: string;
  disabledAfter?: string;
}) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = iso ? parseISO(iso) : undefined;
  const disabledMatchers: Array<{ before: Date } | { after: Date }> = [];
  if (disabledBefore) disabledMatchers.push({ before: parseISO(disabledBefore) });
  if (disabledAfter) disabledMatchers.push({ after: parseISO(disabledAfter) });

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span style={{ color: T.text3, marginRight: 6, fontFamily: T.fontMono, fontSize: 11 }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          color: T.text,
          border: "none",
          borderBottom: `1px dashed ${T.outlineVariant}`,
          padding: "3px 2px 2px",
          fontFamily: T.fontMono,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {formatPickerLabel(iso)}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 50,
            background: T.surfaceLow,
            border: `1px solid ${T.outlineVariant}`,
            borderRadius: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            animation: "psx-pop-in 140ms ease-out",
          }}
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (d) {
                onChange(isoLocal(d));
                setOpen(false);
              }
            }}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
            defaultMonth={selected}
            weekStartsOn={1}
            showOutsideDays
          />
        </div>
      )}
    </div>
  );
}

/* ────────── Capital section ────────── */

function CapitalSection({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const T = useT();
  const presets = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
  // Local string state so the user can type freely (clearing the input,
  // typing intermediate states like "500" → "500000") without the parent
  // committing every keystroke at sub-1 values.
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    // Keep external commits in sync (preset clicks). Only refresh the
    // displayed text when the field isn't being edited so the user's
    // half-typed digits aren't clobbered.
    if (!focused) setText(String(value));
  }, [value, focused]);

  const displayValue =
    focused
      ? text
      : Number.isFinite(Number(text.replace(/,/g, "")))
        ? formatPkr(Number(text.replace(/,/g, "")))
        : text;

  return (
    <Section label="initial capital · pkr" hint="Starting capital used to size each simulated trade.">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              fontFamily: T.fontMono,
              fontSize: 12,
              color: T.text3,
              pointerEvents: "none",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Rs
          </span>
          <input
            type="text"
            inputMode="numeric"
            // Show formatted commas only when the field isn't focused —
            // commas in mid-edit break caret position and feel jittery.
            value={displayValue}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, "");
              setText(raw);
              const n = parseFloat(raw);
              if (Number.isFinite(n) && n > 0) onChange(n);
            }}
            onBlur={() => {
              setFocused(false);
              const n = parseFloat(text.replace(/,/g, ""));
              if (Number.isFinite(n) && n > 0) {
                onChange(n);
                setText(String(n));
              }
            }}
            style={{
              background: T.surface,
              color: T.text,
              border: "none",
              boxShadow: `0 0 0 1px ${T.outlineFaint}`,
              borderRadius: 6,
              padding: "10px 14px 10px 38px",
              fontFamily: T.fontMono,
              fontSize: 14,
              fontVariantNumeric: "tabular-nums",
              width: 220,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {presets.map((amount) => {
            const active = value === amount;
            return (
              <button
                key={amount}
                type="button"
                onClick={() => onChange(amount)}
                disabled={disabled}
                aria-pressed={active}
                className="psx-press"
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: active ? T.primary : "transparent",
                  color: active ? "#fff" : T.text2,
                  border: `1px solid ${active ? T.primary : T.outlineFaint}`,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {compactPkr(amount)}
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ────────── Universe section ────────── */

function UniverseSection({
  scope,
  onScope,
  sectors,
  onSectors,
  tickers,
  onTickers,
  filters,
  onFilters,
  availableSectors,
  availableSymbols,
  totalActive,
  disabled,
}: {
  scope: "all_active" | "by_sector" | "by_ticker" | "by_sector_and_ticker" | null;
  onScope: (next: "all_active" | "by_sector" | "by_ticker" | "by_sector_and_ticker") => void;
  sectors: string[];
  onSectors: (next: string[]) => void;
  tickers: string[];
  onTickers: (next: string[]) => void;
  filters: NumericFilters;
  onFilters: (next: NumericFilters) => void;
  availableSectors: string[];
  availableSymbols: { symbol: string; name?: string | null }[];
  totalActive: number;
  disabled: boolean;
}) {
  const T = useT();
  const [filtersOpen, setFiltersOpen] = useSessionStorage<boolean>(
    "psx:bt:filters-open",
    false,
  );

  const filterCount = activeFilterCount(filters);
  const filterSummary =
    filterCount === 0
      ? "no filters"
      : `${filterCount} filter${filterCount === 1 ? "" : "s"} applied`;

  return (
    <Section
      label="universe"
      hint="Pick the universe this run targets. Required — there's no implicit default, so the run button stays disabled until you choose."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <UniverseSubsection
          kicker="scope"
          info="One choice required. 'All active' uses every active PSX symbol; 'By sector' restricts to the sectors you pick; 'By ticker' restricts to the exact tickers you list."
        >
          <ScopePicker
            scope={scope}
            onChange={onScope}
            totalActive={totalActive}
            disabled={disabled}
          />
        </UniverseSubsection>

        {(scope === "by_sector" || scope === "by_sector_and_ticker") && (
          <UniverseSubsection
            kicker="sectors"
            info="Active stocks in the picked sectors join the universe."
          >
            <MultiSelectPopover
              label="sectors"
              placeholder="pick sectors…"
              options={availableSectors.map((s) => ({ value: s }))}
              selected={sectors}
              onChange={onSectors}
              disabled={disabled}
            />
          </UniverseSubsection>
        )}

        {(scope === "by_ticker" || scope === "by_sector_and_ticker") && (
          <UniverseSubsection
            kicker="tickers"
            info={
              scope === "by_sector_and_ticker"
                ? "Add extra tickers on top of the sectors above. Explicit tickers bypass the numeric filters and the active-stock gate (delisted names allowed)."
                : "Add the exact tickers this run targets. Explicit tickers bypass the active-stock gate so backtests can include delisted names."
            }
          >
            <SymbolPickerInline
              available={availableSymbols}
              selected={tickers}
              onAdd={(sym) => {
                const norm = sym.trim().toUpperCase();
                if (!norm || tickers.includes(norm)) return;
                onTickers([...tickers, norm]);
              }}
              onRemove={(sym) => onTickers(tickers.filter((t) => t !== sym))}
              disabled={disabled}
            />
          </UniverseSubsection>
        )}

        {(scope === "all_active" ||
          scope === "by_sector" ||
          scope === "by_sector_and_ticker") && (
          <Disclosure
            label="numeric filters"
            summary={filterSummary}
            open={filtersOpen}
            onToggle={() => setFiltersOpen((v) => !v)}
            tone="muted"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 14,
                maxWidth: 640,
              }}
            >
              <NumberInput
                label="min price (PKR)"
                value={filters.min_price}
                onChange={(v) => onFilters({ ...filters, min_price: v })}
                disabled={disabled}
                min={0}
              />
              <NumberInput
                label="max price (PKR)"
                value={filters.max_price}
                onChange={(v) => onFilters({ ...filters, max_price: v })}
                disabled={disabled}
                min={0}
              />
              <NumberInput
                label="min daily volume"
                value={filters.min_volume}
                onChange={(v) => onFilters({ ...filters, min_volume: v })}
                disabled={disabled}
                min={0}
                integer
              />
              <NumberInput
                label="min market cap"
                value={filters.min_market_cap}
                onChange={(v) => onFilters({ ...filters, min_market_cap: v })}
                disabled={disabled}
                min={0}
              />
            </div>
          </Disclosure>
        )}
      </div>
    </Section>
  );
}

/** Scope picker — three radio cards. Nothing selected by default; the
 *  parent form blocks submission until the user picks. Closes the
 *  audit-discoverable "silently backtested against all 500 stocks"
 *  bug by requiring an explicit choice.
 */
function ScopePicker({
  scope,
  onChange,
  totalActive,
  disabled,
}: {
  scope: "all_active" | "by_sector" | "by_ticker" | "by_sector_and_ticker" | null;
  onChange: (next: "all_active" | "by_sector" | "by_ticker" | "by_sector_and_ticker") => void;
  totalActive: number;
  disabled: boolean;
}) {
  const T = useT();
  const options: Array<{
    value: "all_active" | "by_sector" | "by_ticker" | "by_sector_and_ticker";
    label: string;
    hint: string;
  }> = [
    {
      value: "all_active",
      label: "All active stocks",
      hint: `Every PSX symbol that's active today (${totalActive.toLocaleString("en-PK")}). Numeric filters still apply.`,
    },
    {
      value: "by_sector",
      label: "By sector",
      hint: "Active stocks in the sectors you pick.",
    },
    {
      value: "by_ticker",
      label: "By ticker",
      hint: "Only the exact tickers you list. Backtests may include delisted names.",
    },
    {
      value: "by_sector_and_ticker",
      label: "By sector + extra tickers",
      hint: "Combine sectors with additional explicit tickers. Numeric filters trim the sector side; explicit tickers come through unfiltered.",
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Universe scope"
      style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 540 }}
    >
      {options.map((opt) => {
        const active = scope === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 14px",
              background: active ? T.surface3 : T.surface,
              color: T.text,
              border: "none",
              boxShadow: `0 0 0 1px ${active ? T.outlineVariant : T.outlineFaint}`,
              borderRadius: 8,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
              fontFamily: "inherit",
              textAlign: "left",
              transition: "background 120ms ease, box-shadow 120ms ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                marginTop: 3,
                width: 14,
                height: 14,
                borderRadius: 999,
                border: `2px solid ${active ? T.text : T.outlineFaint}`,
                background: active ? T.text : "transparent",
                flexShrink: 0,
              }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, color: T.text }}>{opt.label}</span>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: T.text3,
                  lineHeight: 1.4,
                }}
              >
                {opt.hint}
              </span>
            </span>
          </button>
        );
      })}
      {scope === null && (
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            color: T.text3,
            marginTop: 4,
          }}
        >
          nothing picked — run blocked until you choose
        </div>
      )}
    </div>
  );
}

function UniverseSubsection({
  kicker,
  info,
  children,
}: {
  kicker: string;
  info: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Kicker info={info}>{kicker}</Kicker>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

/* ────────── Risk section ────────── */

function RiskSection({
  value,
  onChange,
  disabled,
  strategyDefaults,
}: {
  value: RiskCaps;
  onChange: (v: RiskCaps) => void;
  disabled: boolean;
  /**
   * When the selected strategy authored `default_risk`, the four inheritable
   * exit fields render as InheritableField (ghost / overridden / no-default).
   * Null when the strategy has no defaults — the form falls back to plain
   * inputs and the legacy preset behavior.
   */
  strategyDefaults: DefaultRisk | null;
}) {
  const T = useT();
  const activePreset: "balanced" | "aggressive" | "none" | "custom" = (() => {
    if (risksEqual(value, RISK_DEFAULTS)) return "balanced";
    if (risksEqual(value, RISK_AGGRESSIVE)) return "aggressive";
    if (risksEqual(value, RISK_NONE)) return "none";
    return "custom";
  })();

  return (
    <Section
      label="risk caps"
      hint={
        strategyDefaults
          ? "The strategy authored defaults — leave a field on Inherit to follow the strategy, or click Override to set a per-backtest cap. Presets below override every field at once."
          : "Hard exits applied to every simulated trade. Sensible defaults are pre-filled — tune or switch presets."
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(
            [
              { key: "balanced", label: "Balanced", caps: RISK_DEFAULTS, sub: "stop 5% · max 5 pos" },
              { key: "aggressive", label: "Aggressive", caps: RISK_AGGRESSIVE, sub: "stop 8% · take 20% · max 8" },
              { key: "none", label: "No caps", caps: RISK_NONE, sub: "raw strategy signals" },
            ] as const
          ).map((p) => {
            const active = activePreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange(p.caps)}
                disabled={disabled}
                aria-pressed={active}
                className="psx-press"
                style={{
                  background: active ? T.surface3 : "transparent",
                  color: active ? T.text : T.text2,
                  border: `1px solid ${active ? T.outlineVariant : T.outlineFaint}`,
                  borderRadius: 6,
                  padding: "7px 12px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 1,
                  fontFamily: T.fontSans,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500 }}>{p.label}</span>
                <span
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: 9.5,
                    color: T.text3,
                    letterSpacing: 0.4,
                  }}
                >
                  {p.sub}
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
            maxWidth: 720,
          }}
        >
          <InheritableField
            label="stop loss %"
            caption="Exit if a trade loses more than this."
            defaultFromStrategy={strategyDefaults?.stop_loss_pct}
            value={value.stop_loss_pct}
            onChange={(v) => onChange({ ...value, stop_loss_pct: v })}
            disabled={disabled}
            unit="%"
            min={0}
            max={100}
          />
          <InheritableField
            label="take profit %"
            caption="Exit when a trade gains more than this."
            defaultFromStrategy={strategyDefaults?.take_profit_pct}
            value={value.take_profit_pct}
            onChange={(v) => onChange({ ...value, take_profit_pct: v })}
            disabled={disabled}
            unit="%"
            min={0}
            max={100}
          />
          <InheritableField
            label="trailing stop %"
            caption="Lock in gains as price rises."
            defaultFromStrategy={strategyDefaults?.trailing_stop_pct}
            value={value.trailing_stop_pct}
            onChange={(v) => onChange({ ...value, trailing_stop_pct: v })}
            disabled={disabled}
            unit="%"
            min={0}
            max={100}
          />
          <InheritableField
            label="max holding days"
            caption="Force-close trades after this many days."
            defaultFromStrategy={strategyDefaults?.max_holding_days}
            value={value.max_holding_days}
            onChange={(v) => onChange({ ...value, max_holding_days: v })}
            disabled={disabled}
            unit="d"
            min={1}
            integer
          />
          <RiskField
            label="max concurrent positions"
            caption="How many open trades at once."
            value={value.max_positions}
            onChange={(v) => onChange({ ...value, max_positions: v })}
            disabled={disabled}
            integer
            max={50}
          />
        </div>
      </div>
    </Section>
  );
}

function RiskField({
  label,
  caption,
  value,
  onChange,
  disabled,
  max,
  integer,
}: {
  label: string;
  caption: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled: boolean;
  max?: number;
  integer?: boolean;
}) {
  const T = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <NumberInput
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        min={0}
        max={max}
        integer={integer}
      />
      <span style={{ fontFamily: T.fontSans, fontSize: 10.5, color: T.text3, lineHeight: 1.4 }}>
        {caption}
      </span>
    </div>
  );
}

/* ────────── Helpers ────────── */

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const T = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Kicker info={hint}>{label}</Kicker>
      <div style={{ marginTop: -2 }}>{children}</div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  integer = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const T = useT();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 10,
          color: T.text3,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <input
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        value={value ?? ""}
        min={min}
        max={max}
        step={integer ? 1 : "any"}
        disabled={disabled}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const n = integer ? parseInt(raw, 10) : parseFloat(raw);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        style={{
          background: T.surface,
          color: T.text,
          border: "none",
          boxShadow: `0 0 0 1px ${T.outlineFaint}`,
          borderRadius: 6,
          padding: "8px 10px",
          fontFamily: T.fontMono,
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
          width: "100%",
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </label>
  );
}

/* ────────── Inline symbol picker (kept inline because the universe-mode
    surface owns its UI state separately from the shared component). ───── */

function SymbolPickerInline({
  available,
  selected,
  onAdd,
  onRemove,
  disabled,
}: {
  available: { symbol: string; name?: string | null }[];
  selected: string[];
  onAdd: (sym: string) => void;
  onRemove: (sym: string) => void;
  disabled: boolean;
}) {
  const T = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const exclude = new Set(selected);
    const starts: typeof available = [];
    const contains: typeof available = [];
    for (const opt of available) {
      if (exclude.has(opt.symbol)) continue;
      const sym = opt.symbol.toUpperCase();
      const name = (opt.name ?? "").toUpperCase();
      if (sym.startsWith(q)) starts.push(opt);
      else if (sym.includes(q) || name.includes(q)) contains.push(opt);
      if (starts.length + contains.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [query, available, selected]);

  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function commit(sym: string) {
    onAdd(sym);
    setQuery("");
    setHighlight(0);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (matches.length === 0 ? 0 : (h + 1) % matches.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        matches.length === 0 ? 0 : (h - 1 + matches.length) % matches.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[highlight]) commit(matches[highlight].symbol);
      else if (query.trim()) commit(query);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 360 }}>
      <input
        type="text"
        value={query}
        placeholder="search and add a ticker"
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        style={{
          background: T.surface,
          color: T.text,
          border: "none",
          boxShadow: `0 0 0 1px ${T.outlineFaint}`,
          borderRadius: 6,
          padding: "9px 12px",
          fontFamily: T.fontMono,
          fontSize: 12.5,
          width: "100%",
          opacity: disabled ? 0.6 : 1,
        }}
      />
      {open && matches.length > 0 && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: T.surface2,
            borderRadius: 8,
            boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 12px 32px -12px rgba(0,0,0,0.5)`,
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 10,
          }}
        >
          {matches.map((opt, i) => {
            const active = i === highlight;
            return (
              <div
                key={opt.symbol}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt.symbol);
                }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 10,
                  background: active ? T.surface3 : "transparent",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontFamily: T.fontMono, fontSize: 13, color: T.text }}>
                  {opt.symbol}
                </span>
                {opt.name && (
                  <span
                    style={{
                      fontFamily: T.fontSans,
                      fontSize: 11,
                      color: T.text3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "60%",
                    }}
                  >
                    {opt.name}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {selected.map((sym) => (
            <span
              key={sym}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 6px 5px 10px",
                background: T.surface3,
                border: `1px solid ${T.outlineFaint}`,
                borderRadius: 999,
                fontFamily: T.fontMono,
                fontSize: 11.5,
                color: T.text,
              }}
            >
              {sym}
              <button
                type="button"
                onClick={() => onRemove(sym)}
                disabled={disabled}
                aria-label={`Remove ${sym}`}
                style={{
                  background: "transparent",
                  border: "none",
                  color: T.text3,
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontSize: 13,
                  padding: "0 4px",
                  lineHeight: 1,
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
