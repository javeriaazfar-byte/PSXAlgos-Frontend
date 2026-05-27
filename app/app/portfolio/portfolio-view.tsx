"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppFrame } from "@/components/frame";
import { useT, type Tokens } from "@/components/theme";
import {
  Btn,
  Combobox,
  DotRow,
  EditorialHeader,
  Kicker,
  Lede,
  Modal,
  Ribbon,
  TerminalTable,
  useFlash,
  type ComboOption,
  type Col,
} from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";
import { drainSignalTrades, type PendingPosition } from "@/lib/signal-log-bridge";
import {
  fromCSV,
  todayLabel,
  toCSV,
  type ClosedTrade,
  type CloseReason,
  type OpenPosition,
  type TradeSource,
} from "@/lib/portfolio-csv";
import type {
  ClosedTradeResponse,
  JournalCloseReason,
  JournalSource,
  OpenPositionCreateBody,
  OpenPositionResponse,
} from "@/lib/api/portfolio";

/* ────────── Backend ↔ UI shape adapters ────────── */

// Mirrors the same maps in app/portfolio/page.tsx — duplicated client-side
// because mutation responses come back through fetch() and never touch the
// server adapter. Kept narrow (no formatting, no fallbacks) since both
// modules import the same types and the conversion is symmetric.

function num(d: string | number | null | undefined, fallback = 0): number {
  if (d === null || d === undefined) return fallback;
  const n = typeof d === "number" ? d : Number(d);
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function uiSource(s: JournalSource): TradeSource {
  return s === "SIGNAL" ? "signal" : "manual";
}

function uiReason(r: JournalCloseReason): CloseReason {
  if (r === "STOP_LOSS") return "Stop loss";
  if (r === "TARGET_HIT") return "Target hit";
  return "Manual close";
}

function backendSource(s: TradeSource): JournalSource {
  return s === "signal" ? "SIGNAL" : "MANUAL";
}

function backendReason(r: CloseReason): JournalCloseReason {
  if (r === "Stop loss") return "STOP_LOSS";
  if (r === "Target hit") return "TARGET_HIT";
  return "MANUAL_CLOSE";
}

function adaptPosition(p: OpenPositionResponse): OpenPosition {
  const entry = num(p.entry_price);
  // Mirrors the same null-passthrough in app/portfolio/page.tsx — see the
  // comment there for the "no EOD row yet" rationale.
  const now =
    p.current_price === null || p.current_price === undefined
      ? null
      : num(p.current_price, entry);
  return {
    id: String(p.id),
    sym: p.symbol,
    qty: p.quantity,
    entry,
    now,
    source: uiSource(p.source),
    strat: p.strategy_name ?? null,
    date: formatDate(p.opened_at),
    stop: num(p.stop_price),
    target: num(p.target_price),
  };
}

function adaptClosed(c: ClosedTradeResponse): ClosedTrade {
  return {
    id: String(c.id),
    sym: c.symbol,
    qty: c.quantity,
    entry: num(c.entry_price),
    exit: num(c.exit_price),
    pnl: num(c.pnl),
    ret: num(c.return_pct),
    date: formatDate(c.closed_at),
    reason: uiReason(c.close_reason),
    source: uiSource(c.source),
    strat: c.strategy_name ?? null,
  };
}

function buildCreateBody(p: Omit<OpenPosition, "id">): OpenPositionCreateBody {
  return {
    symbol: p.sym,
    quantity: p.qty,
    entry_price: p.entry,
    stop_price: p.stop > 0 ? p.stop : null,
    target_price: p.target > 0 ? p.target : null,
    source: backendSource(p.source),
    strategy_name: p.strat ?? null,
  };
}

async function readError(resp: Response): Promise<string> {
  // For 4xx the backend's `detail` is intentionally curated, user-actionable
  // text (e.g. "Insufficient quantity for this position"). 5xx responses can
  // leak internal error formatting, so we collapse those to a generic
  // "something broke" line and log the raw payload for debugging instead.
  let raw: unknown = undefined;
  try {
    raw = await resp.json();
  } catch {
    /* fallthrough */
  }
  if (resp.status >= 500) {
    console.warn(`[portfolio] ${resp.status} response`, raw);
    return "server error — please try again";
  }
  if (typeof (raw as { detail?: unknown })?.detail === "string") {
    return (raw as { detail: string }).detail;
  }
  if (typeof (raw as { error?: unknown })?.error === "string") {
    return (raw as { error: string }).error;
  }
  const detailMsg = (raw as { detail?: { message?: unknown } })?.detail?.message;
  if (detailMsg) return String(detailMsg);
  return `request failed (${resp.status})`;
}

/* ────────── Sector palette ──────────
 * Sector names themselves come from the backend /stocks payload (joined by
 * symbol via the sectorMap prop). The palette below colors a curated set
 * of large PSX sectors; anything outside it falls back to T.text3, which
 * matches the previous "Other" treatment. Add entries here if a sector
 * shows up frequently enough to deserve its own color.
 */
const SECTOR_COLOR = (T: Tokens): Record<string, string> => ({
  "Oil & Gas Exploration Companies": T.primary,
  "Oil & Gas Marketing Companies": T.primaryLight,
  "Cement": T.accent,
  "Commercial Banks": T.deploy,
  "Fertilizer": T.warning,
  "Other": T.text3,
});

/* ────────── View ────────── */

export interface SymbolOption {
  symbol: string;
  name: string | null;
}

export interface StrategyOption {
  id: number;
  name: string;
  status: string;
}

interface PortfolioViewProps {
  initialPositions: OpenPosition[];
  initialClosed: ClosedTrade[];
  symbolOptions: SymbolOption[];
  strategyOptions: StrategyOption[];
  // symbol → sector_name from /stocks. Missing entries fall back to "Other".
  sectorMap: Record<string, string>;
  fetchFailed?: boolean;
  // ISO timestamp from the server component representing when the data was
  // fetched. Used to render an honest "last loaded N min ago" string in the
  // header instead of the prior hardcoded "just now".
  fetchedAt?: string;
}

export function PortfolioView({
  initialPositions,
  initialClosed,
  symbolOptions,
  strategyOptions,
  sectorMap,
  fetchFailed = false,
  fetchedAt,
}: PortfolioViewProps) {
  const [positions, setPositions] = useState<OpenPosition[]>(initialPositions);
  const [closed, setClosed] = useState<ClosedTrade[]>(initialClosed);
  const [logOpen, setLogOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<OpenPosition | null>(null);
  const { flash, setFlash } = useFlash();
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fetchFailed) setFlash("Couldn't load your portfolio — showing partial data");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFailed]);

  const empty = positions.length === 0 && closed.length === 0;

  // Drain queued "log this trade" hand-offs from /signals on first mount.
  // Each pending trade is POSTed sequentially — the bridge is rare enough
  // (one trade at a time in practice) that batching adds complexity without
  // materially improving UX.
  useEffect(() => {
    const pending = drainSignalTrades();
    if (pending.length === 0) return;
    void postSignalQueue(pending);
    async function postSignalQueue(items: PendingPosition[]) {
      const created: OpenPosition[] = [];
      const failures: string[] = [];
      for (const item of items) {
        try {
          const resp = await fetch(`/api/portfolio/positions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(buildCreateBody(item)),
          });
          if (!resp.ok) {
            failures.push(item.sym);
            continue;
          }
          created.push(adaptPosition((await resp.json()) as OpenPositionResponse));
        } catch {
          failures.push(item.sym);
        }
      }
      if (created.length > 0) {
        setPositions((rows) => [...created, ...rows]);
      }
      if (failures.length > 0 && created.length > 0) {
        setFlash(`Logged ${created.length} from signals · ${failures.length} failed`);
      } else if (failures.length > 0) {
        setFlash(`Could not log ${failures.length} signal trade${failures.length === 1 ? "" : "s"}`);
      } else if (created.length === 1) {
        setFlash(`Logged from signals · ${created[0].sym}`);
      } else {
        setFlash(`Logged ${created.length} trades from signals`);
      }
    }
  }, [setFlash]);

  async function handleLog(p: Omit<OpenPosition, "id">): Promise<boolean> {
    try {
      const resp = await fetch(`/api/portfolio/positions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCreateBody(p)),
      });
      if (!resp.ok) {
        setFlash(`Could not log ${p.sym}: ${await readError(resp)}`);
        return false;
      }
      const row = adaptPosition((await resp.json()) as OpenPositionResponse);
      setPositions((rows) => [row, ...rows]);
      setFlash(`Logged ${row.sym} · ${row.qty.toLocaleString()} @ ${row.entry.toFixed(2)}`);
      return true;
    } catch (err) {
      setFlash(`Could not log: ${err instanceof Error ? err.message : "network error"}`);
      return false;
    }
  }

  async function handleClose(
    pos: OpenPosition,
    exit: number,
    reason: CloseReason,
  ): Promise<boolean> {
    try {
      const resp = await fetch(`/api/portfolio/positions/${pos.id}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exit_price: exit, close_reason: backendReason(reason) }),
      });
      if (!resp.ok) {
        setFlash(`Could not close ${pos.sym}: ${await readError(resp)}`);
        return false;
      }
      const closedRow = adaptClosed((await resp.json()) as ClosedTradeResponse);
      setClosed((rows) => [closedRow, ...rows]);
      setPositions((rows) => rows.filter((r) => r.id !== pos.id));
      setFlash(
        `Closed ${closedRow.sym} · ${closedRow.pnl >= 0 ? "+" : ""}${closedRow.pnl.toLocaleString()} P&L`,
      );
      return true;
    } catch (err) {
      setFlash(`Could not close: ${err instanceof Error ? err.message : "network error"}`);
      return false;
    }
  }

  async function handleDeletePosition(pos: OpenPosition): Promise<void> {
    try {
      const resp = await fetch(`/api/portfolio/positions/${pos.id}`, { method: "DELETE" });
      if (!resp.ok) {
        setFlash(`Could not delete ${pos.sym}: ${await readError(resp)}`);
        return;
      }
      setPositions((rows) => rows.filter((r) => r.id !== pos.id));
    } catch (err) {
      setFlash(`Could not delete ${pos.sym}: ${err instanceof Error ? err.message : "network error"}`);
    }
  }

  async function handleDeleteTrade(trade: ClosedTrade): Promise<void> {
    try {
      const resp = await fetch(`/api/portfolio/trades/${trade.id}`, { method: "DELETE" });
      if (!resp.ok) {
        setFlash(`Could not delete ${trade.sym}: ${await readError(resp)}`);
        return;
      }
      setClosed((rows) => rows.filter((r) => r.id !== trade.id));
    } catch (err) {
      setFlash(`Could not delete ${trade.sym}: ${err instanceof Error ? err.message : "network error"}`);
    }
  }

  function handleExport() {
    const csv = toCSV(positions, closed);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFlash(`Exported ${positions.length + closed.length} rows`);
  }

  async function handleImportFile(file: File) {
    let parsed;
    try {
      const text = await file.text();
      parsed = fromCSV(text);
    } catch (err) {
      setFlash(`Import failed: ${err instanceof Error ? err.message : "bad file"}`);
      return;
    }
    if (!parsed.open.length && !parsed.closed.length) {
      setFlash("No valid rows found in file");
      return;
    }

    setFlash(`Importing ${parsed.open.length + parsed.closed.length} rows…`);

    const newOpen: OpenPosition[] = [];
    const newClosed: ClosedTrade[] = [];
    let failures = 0;

    // Open rows: a single POST each. Closed rows: create + immediately close,
    // so the server computes pnl/return from entry/exit. Two round-trips per
    // closed row is acceptable for an explicit import action.
    for (const o of parsed.open) {
      try {
        const resp = await fetch(`/api/portfolio/positions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildCreateBody(o)),
        });
        if (!resp.ok) { failures++; continue; }
        newOpen.push(adaptPosition((await resp.json()) as OpenPositionResponse));
      } catch {
        failures++;
      }
    }

    for (const c of parsed.closed) {
      try {
        // Reuse the open shape for the create call.
        const createBody = buildCreateBody({
          sym: c.sym, qty: c.qty, entry: c.entry, now: c.entry,
          source: c.source, strat: c.strat, date: c.date,
          stop: 0, target: 0,
        });
        const createResp = await fetch(`/api/portfolio/positions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createBody),
        });
        if (!createResp.ok) { failures++; continue; }
        const created = (await createResp.json()) as OpenPositionResponse;
        const closeResp = await fetch(`/api/portfolio/positions/${created.id}/close`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exit_price: c.exit, close_reason: backendReason(c.reason) }),
        });
        if (!closeResp.ok) { failures++; continue; }
        newClosed.push(adaptClosed((await closeResp.json()) as ClosedTradeResponse));
      } catch {
        failures++;
      }
    }

    if (newOpen.length > 0) setPositions((rows) => [...newOpen, ...rows]);
    if (newClosed.length > 0) setClosed((rows) => [...newClosed, ...rows]);

    const okMsg = `${newOpen.length} open · ${newClosed.length} closed`;
    setFlash(failures > 0 ? `Imported ${okMsg} · ${failures} failed` : `Imported ${okMsg}`);
  }

  function triggerImport() {
    importRef.current?.click();
  }

  return (
    <AppFrame route="/portfolio">
      <input
        ref={importRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImportFile(f);
          e.target.value = "";
        }}
      />
      <Body
        positions={positions}
        closed={closed}
        empty={empty}
        onLogClick={() => setLogOpen(true)}
        onExport={handleExport}
        onImport={triggerImport}
        onRowClick={(p) => setCloseTarget(p)}
        onDeletePosition={handleDeletePosition}
        onDeleteTrade={handleDeleteTrade}
        flash={flash}
        sectorMap={sectorMap}
        fetchedAt={fetchedAt}
      />
      {logOpen && (
        <LogTradeModal
          onClose={() => setLogOpen(false)}
          symbolOptions={symbolOptions}
          strategyOptions={strategyOptions}
          onSubmit={async (p) => {
            const ok = await handleLog(p);
            if (ok) setLogOpen(false);
            return ok;
          }}
        />
      )}
      {closeTarget && (
        <ClosePositionModal
          position={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSubmit={async (pos, exit, reason) => {
            const ok = await handleClose(pos, exit, reason);
            if (ok) setCloseTarget(null);
            return ok;
          }}
        />
      )}
    </AppFrame>
  );
}

/* ────────── Body ────────── */

interface BodyProps {
  positions: OpenPosition[];
  closed: ClosedTrade[];
  empty: boolean;
  onLogClick: () => void;
  onExport: () => void;
  onImport: () => void;
  onRowClick: (p: OpenPosition) => void;
  onDeletePosition: (pos: OpenPosition) => Promise<void>;
  onDeleteTrade: (trade: ClosedTrade) => Promise<void>;
  flash: string | null;
  sectorMap: Record<string, string>;
  fetchedAt?: string;
}

function Body({
  positions,
  closed,
  empty,
  onLogClick,
  onExport,
  onImport,
  onRowClick,
  onDeletePosition,
  onDeleteTrade,
  flash,
  sectorMap,
  fetchedAt,
}: BodyProps) {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);

  // Totals only account for positions with a known current_price. An
  // unpriced row (no EOD data yet) can't contribute a meaningful market
  // value or unrealized pnl, so it's excluded from the aggregate rather
  // than silently treated as flat-at-entry.
  const pricedPositions = positions.filter((p) => p.now !== null);
  const unpricedCount = positions.length - pricedPositions.length;
  const totalCost = pricedPositions.reduce((s, p) => s + p.entry * p.qty, 0);
  const totalValue = pricedPositions.reduce((s, p) => s + (p.now as number) * p.qty, 0);
  const unrealized = totalValue - totalCost;
  const unrealizedPct = totalCost ? (unrealized / totalCost) * 100 : 0;
  const realizedYTD = closed.reduce((s, t) => s + t.pnl, 0);

  const wins = closed.filter((c) => c.pnl > 0).length;
  const losses = closed.length - wins;
  const winRatePct = closed.length ? (wins / closed.length) * 100 : 0;

  const attribution = useMemo(() => buildAttribution(positions, closed), [positions, closed]);
  const signalEdgePkr = attribution.signal.pnl - attribution.manual.pnl;

  const sectors = useMemo(
    () => buildSectors(positions, T, sectorMap),
    [positions, T, sectorMap],
  );

  // Re-render every 60s so the "loaded N min ago" label stays honest without
  // hammering. fetchedAt is set once when the server component renders; the
  // label degrades from "just now" → "1 min ago" → "5 min ago" etc.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!fetchedAt) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [fetchedAt]);
  const loadedAgo = useMemo(() => {
    if (!fetchedAt) return null;
    const t = new Date(fetchedAt).getTime();
    if (!Number.isFinite(t)) return null;
    const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000));
    if (mins < 1) return "loaded just now";
    if (mins < 60) return `loaded ${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `loaded ${hrs}h ago`;
  }, [fetchedAt]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <EditorialHeader
        kicker="Manual ledger · your actual broker trades"
        title={
          <>
            Portfolio{" "}
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>·</span>{" "}
            {empty ? (
              <span style={{ color: T.text3, fontWeight: 400, fontSize: "0.7em" }}>
                nothing logged yet
              </span>
            ) : (
              "live"
            )}
          </>
        }
        meta={
          empty ? (
            <span>No positions</span>
          ) : (
            <>
              <span>
                {positions.length} open · {closed.length} closed
              </span>
              <span>PKR {(totalValue / 1000).toFixed(0)}K invested</span>
              <span style={{ color: unrealized >= 0 ? T.gain : T.loss }}>
                {unrealized >= 0 ? "+" : ""}
                {unrealized.toLocaleString()} unrealized
              </span>
              {unpricedCount > 0 && (
                <span style={{ color: T.text3 }}>
                  {unpricedCount} awaiting price
                </span>
              )}
              {loadedAgo && <span style={{ color: T.text3 }}>{loadedAgo}</span>}
            </>
          )
        }
        actions={
          <>
            <Btn variant="ghost" size="sm" onClick={onExport}>
              Export CSV
            </Btn>
            <Btn variant="primary" size="sm" icon={Icon.plus} onClick={onLogClick}>
              Log a trade
            </Btn>
          </>
        }
      />

      {flash && <FlashBar message={flash} />}

      {empty ? (
        <EmptyState onLogClick={onLogClick} onImport={onImport} />
      ) : (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: pick(bp, {
              mobile: `20px ${padX} 28px`,
              desktop: `32px ${padX} 40px`,
            }),
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: pick(bp, {
                mobile: "1fr 1fr",
                tablet: "repeat(3, 1fr)",
                desktop: "repeat(5, 1fr)",
              }),
              gap: pick(bp, { mobile: 20, desktop: 36 }),
              paddingBottom: 26,
              borderBottom: `1px solid ${T.outlineFaint}`,
            }}
          >
            <Lede
              label="Market value"
              value={`PKR ${(totalValue / 1000).toFixed(0)}K`}
              sub={`cost ${(totalCost / 1000).toFixed(0)}K`}
              size="clamp(22px, 2.5vw, 28px)"
            />
            <Lede
              label="Unrealized P&L"
              value={`${unrealized >= 0 ? "+" : ""}${unrealized.toLocaleString()}`}
              color={unrealized >= 0 ? T.gain : T.loss}
              sub={`${unrealizedPct >= 0 ? "+" : ""}${unrealizedPct.toFixed(2)}%`}
              size="clamp(22px, 2.5vw, 28px)"
            />
            <Lede
              label="Realized (YTD)"
              value={`${realizedYTD >= 0 ? "+" : ""}${realizedYTD.toLocaleString()}`}
              color={realizedYTD >= 0 ? T.gain : T.loss}
              sub={`${closed.length} trade${closed.length === 1 ? "" : "s"} closed`}
              size="clamp(22px, 2.5vw, 28px)"
            />
            <Lede
              label="Signal edge"
              value={`${signalEdgePkr >= 0 ? "+" : ""}PKR ${Math.abs(signalEdgePkr).toLocaleString()}`}
              color={signalEdgePkr >= 0 ? T.gain : T.loss}
              sub="signal P&L vs manual P&L"
              size="clamp(22px, 2.5vw, 28px)"
            />
            <Lede
              label="Win rate"
              value={closed.length ? `${winRatePct.toFixed(0)}%` : "—"}
              sub={closed.length ? `${wins} win${wins === 1 ? "" : "s"} / ${losses} loss${losses === 1 ? "" : "es"}` : "no closed trades yet"}
              size="clamp(22px, 2.5vw, 28px)"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: pick(bp, {
                mobile: "1fr",
                tablet: "1.1fr 1fr",
                desktop: "1.1fr 1fr",
              }),
              gap: pick(bp, { mobile: 28, tablet: 32, desktop: 48 }),
              marginTop: 28,
            }}
          >
            <div>
              <Ribbon
                kicker="source attribution"
                right={
                  <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                    where does your edge come from?
                  </span>
                }
              />
              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: isMobile ? 12 : 24,
                }}
              >
                <AttributionCard
                  title="Signal trades"
                  data={attribution.signal}
                  accent={T.deploy}
                  bg={T.deploy + "11"}
                  border={`1px solid ${T.deploy}33`}
                />
                <AttributionCard
                  title="Manual trades"
                  data={attribution.manual}
                  accent={T.text3}
                  bg={T.surfaceLow}
                  border={`1px solid ${T.outlineFaint}`}
                />
              </div>
              <AttributionObservation
                signal={attribution.signal}
                manual={attribution.manual}
              />
            </div>

            <div>
              <Ribbon kicker="allocation by sector" />
              <div style={{ marginTop: 14 }}>
                {sectors.length === 0 ? (
                  <div
                    style={{
                      padding: "14px 0",
                      fontSize: 12.5,
                      color: T.text3,
                      fontStyle: "italic",
                    }}
                  >
                    No open positions — nothing to allocate.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile
                        ? "minmax(0, 1fr) 90px max-content"
                        : "minmax(0, 1fr) 160px max-content",
                    }}
                  >
                    {sectors.map(([s, pct, c]) => (
                      <div
                        key={s}
                        style={{
                          display: "grid",
                          gridColumn: "1 / -1",
                          gridTemplateColumns: "subgrid",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 0",
                          borderBottom: `1px dotted ${T.outlineFaint}`,
                        }}
                      >
                        <span style={{ fontSize: 12.5, color: T.text2 }}>{s}</span>
                        <div style={{ position: "relative", height: 4, background: T.surface3 }}>
                          <div style={{ width: `${Math.min(100, pct)}%`, height: 4, background: c }} />
                        </div>
                        <span
                          style={{
                            fontFamily: T.fontMono,
                            fontSize: 11,
                            color: T.text3,
                            textAlign: "right",
                          }}
                        >
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 40 }}>
            <Ribbon
              kicker="open positions"
              right={
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  tap a row to log a close
                </span>
              }
            />
            <div style={{ marginTop: 8 }}>
              <OpenPositionsTable rows={positions} onRowClick={onRowClick} onDeletePosition={onDeletePosition} />
            </div>
          </div>

          <div style={{ marginTop: 36 }}>
            <Ribbon
              kicker="recently closed"
              right={
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  {closed.length} total
                </span>
              }
            />
            <div style={{ marginTop: 8 }}>
              <ClosedTable rows={closed} onDeleteTrade={onDeleteTrade} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────── Attribution ────────── */

interface SourceStats {
  open: number;
  closed: number;
  wins: number;
  pnl: number;
  avgRetPct: number | null;
}

interface Attribution {
  signal: SourceStats;
  manual: SourceStats;
}

function buildAttribution(positions: OpenPosition[], closed: ClosedTrade[]): Attribution {
  function pick(src: TradeSource): SourceStats {
    const cs = closed.filter((c) => c.source === src);
    const pnl = cs.reduce((s, c) => s + c.pnl, 0);
    const wins = cs.filter((c) => c.pnl > 0).length;
    const avgRetPct = cs.length ? cs.reduce((s, c) => s + c.ret, 0) / cs.length : null;
    return {
      open: positions.filter((p) => p.source === src).length,
      closed: cs.length,
      wins,
      pnl,
      avgRetPct,
    };
  }
  return { signal: pick("signal"), manual: pick("manual") };
}

function AttributionCard({
  title,
  data,
  accent,
  bg,
  border,
}: {
  title: string;
  data: SourceStats;
  accent: string;
  bg: string;
  border: string;
}) {
  const T = useT();
  const empty = data.open === 0 && data.closed === 0;
  const retColor =
    data.avgRetPct === null
      ? T.text2
      : data.avgRetPct >= 0
        ? T.gain
        : T.loss;
  const winPct = data.closed ? (data.wins / data.closed) * 100 : 0;
  return (
    <div style={{ padding: 20, background: bg, borderRadius: 6, border }}>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 10.5,
          color: accent,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: T.fontHead,
          fontSize: 34,
          fontWeight: 500,
          margin: "6px 0",
          color: empty ? T.text3 : retColor,
        }}
      >
        {data.avgRetPct === null
          ? "—"
          : `${data.avgRetPct >= 0 ? "+" : ""}${data.avgRetPct.toFixed(1)}%`}
      </div>
      <div style={{ fontSize: 12, color: T.text2 }}>
        {data.open} open · {data.closed} closed
        {data.closed > 0 && ` · ${winPct.toFixed(0)}% win`}
      </div>
      <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
        {empty
          ? "no trades yet"
          : data.closed
            ? `${data.pnl >= 0 ? "+" : ""}${data.pnl.toLocaleString()} realized`
            : "open only · no closes"}
      </div>
    </div>
  );
}

function AttributionObservation({
  signal,
  manual,
}: {
  signal: SourceStats;
  manual: SourceStats;
}) {
  const T = useT();
  let text: ReactNode;
  if (signal.avgRetPct === null && manual.avgRetPct === null) {
    text = (
      <>
        <span style={{ color: T.primaryLight }}>Observation ·</span> No closed trades yet — close a
        position to start building attribution data.
      </>
    );
  } else if (signal.avgRetPct !== null && manual.avgRetPct !== null) {
    const diff = signal.avgRetPct - manual.avgRetPct;
    const direction = diff >= 0 ? "outperforming" : "underperforming";
    const color = diff >= 0 ? T.gain : T.loss;
    text = (
      <>
        <span style={{ color: T.primaryLight }}>Observation ·</span> Signal-driven trades are{" "}
        {direction} discretionary trades by
        <span style={{ color }}> {Math.abs(diff).toFixed(1)} percentage points</span>.
        {diff >= 0 ? " Consider deploying more strategies." : " Review recent signal quality."}
      </>
    );
  } else if (signal.avgRetPct !== null) {
    text = (
      <>
        <span style={{ color: T.primaryLight }}>Observation ·</span> Only signal-driven closes so
        far — log a manual close to compare.
      </>
    );
  } else {
    text = (
      <>
        <span style={{ color: T.primaryLight }}>Observation ·</span> Only manual closes so far —
        follow a signal to start building attribution.
      </>
    );
  }
  return (
    <div
      style={{
        marginTop: 14,
        padding: 12,
        background: T.surfaceLow,
        borderRadius: 6,
        fontSize: 12,
        color: T.text2,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}

/* ────────── Sectors ────────── */

function buildSectors(
  positions: OpenPosition[],
  T: Tokens,
  sectorMap: Record<string, string>,
): Array<[string, number, string]> {
  // Allocation by market value — unpriced rows have no defined value, so
  // they're excluded entirely. The "X awaiting price" note in the header
  // already surfaces their existence to the user.
  const priced = positions.filter((p) => p.now !== null);
  if (!priced.length) return [];
  const totals: Record<string, number> = {};
  let grand = 0;
  for (const p of priced) {
    const sector = sectorMap[p.sym] ?? "Other";
    const v = (p.now as number) * p.qty;
    totals[sector] = (totals[sector] ?? 0) + v;
    grand += v;
  }
  const colors = SECTOR_COLOR(T);
  return Object.entries(totals)
    .map(([s, v]): [string, number, string] => [s, (v / grand) * 100, colors[s] ?? T.text3])
    .sort((a, b) => b[1] - a[1]);
}

/* ────────── Tables ────────── */

type KebabState = "closed" | "menu" | "confirm" | "deleting";

function OpenPositionsTable({
  rows,
  onRowClick,
  onDeletePosition,
}: {
  rows: OpenPosition[];
  onRowClick: (p: OpenPosition) => void;
  onDeletePosition: (pos: OpenPosition) => Promise<void>;
}) {
  const T = useT();
  const [kebab, setKebab] = useState<Record<string, KebabState>>({});

  function openKebab(id: string) {
    setKebab({ [id]: "menu" });
  }
  function closeKebab(id: string) {
    setKebab((prev) => ({ ...prev, [id]: "closed" }));
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target?.closest("[data-kebab-menu]")) {
        setKebab({});
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const cols: Col[] = [
    { label: "symbol", width: "90px", primary: true },
    { label: "source", width: "100px", mono: false, mobileFullWidth: true },
    { label: "qty", align: "right", width: "80px" },
    { label: "entry", align: "right", width: "90px" },
    { label: "now", align: "right", width: "90px" },
    { label: "cost", align: "right", width: "120px" },
    { label: "value", align: "right", width: "120px" },
    { label: "p&l", align: "right", width: "110px" },
    { label: "return", align: "right", width: "90px" },
    { label: "held", align: "right", width: "70px" },
    { label: "", width: "40px", hideOnMobile: true },
  ];
  const tableRows: unknown[][] = rows.map((p) => {
    // null now ⇒ no current price ⇒ no value/pnl/return; render the cell
    // sentinel that renderCell turns into a muted em-dash. Cost (entry × qty)
    // is always knowable from logged data and stays numeric.
    const value = p.now === null ? null : p.now * p.qty;
    const pnl = p.now === null ? null : (p.now - p.entry) * p.qty;
    const ret = p.now === null ? null : ((p.now - p.entry) / p.entry) * 100;
    return [p.sym, p, p.qty, p.entry, p.now, p.entry * p.qty, value, pnl, ret, p.date, p];
  });
  if (!rows.length) {
    return (
      <div
        style={{
          padding: "22px 0",
          fontSize: 12.5,
          color: T.text3,
          fontStyle: "italic",
          borderTop: `1px solid ${T.outlineFaint}`,
          borderBottom: `1px solid ${T.outlineFaint}`,
        }}
      >
        No open positions. Use <span style={{ color: T.primaryLight }}>Log a trade</span> to add
        one.
      </div>
    );
  }
  return (
    <TerminalTable
      cols={cols}
      rows={tableRows}
      onRowClick={(_, ri) => onRowClick(rows[ri])}
      renderCell={(cell, ci, ri) => {
        // Cells with cell === null (now/value/pnl/return for an unpriced
        // row) render as a muted em-dash so the row stays parseable but
        // doesn't fake a 0% return.
        const dash = (
          <span style={{ color: T.text3, fontStyle: "italic" }}>—</span>
        );
        if (ci === 0)
          return <span style={{ color: T.text, fontWeight: 500 }}>{cell as ReactNode}</span>;
        if (ci === 1) {
          const p = cell as OpenPosition;
          if (p.source === "signal")
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: T.deploy, fontSize: 10 }}>◉</span>
                <span style={{ color: T.primaryLight, fontSize: 11 }}>{p.strat}</span>
              </span>
            );
          return <span style={{ color: T.text3, fontSize: 11 }}>manual</span>;
        }
        if (ci === 2) return <span style={{ color: T.text2 }}>{(cell as number).toLocaleString()}</span>;
        if (ci === 3) return <span style={{ color: T.text2 }}>{(cell as number).toFixed(2)}</span>;
        if (ci === 4) {
          if (cell === null) return dash;
          return <span style={{ color: T.text2 }}>{(cell as number).toFixed(2)}</span>;
        }
        if (ci === 5) return <span style={{ color: T.text3 }}>{(cell as number).toLocaleString()}</span>;
        if (ci === 6) {
          if (cell === null) return dash;
          return <span style={{ color: T.text }}>{(cell as number).toLocaleString()}</span>;
        }
        if (ci === 7) {
          if (cell === null) return dash;
          const n = cell as number;
          return (
            <span style={{ color: n >= 0 ? T.gain : T.loss }}>
              {n >= 0 ? "+" : ""}
              {Math.round(n).toLocaleString()}
            </span>
          );
        }
        if (ci === 8) {
          if (cell === null) return dash;
          const n = cell as number;
          return (
            <span style={{ color: n >= 0 ? T.gain : T.loss }}>
              {n >= 0 ? "+" : ""}
              {n.toFixed(2)}%
            </span>
          );
        }
        if (ci === 9) return <span style={{ color: T.text3 }}>{cell as ReactNode}</span>;
        if (ci === 10) {
          const pos = cell as OpenPosition;
          const state = kebab[pos.id] ?? "closed";
          if (state === "confirm" || state === "deleting") {
            return (
              <span
                data-kebab-menu
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={(e) => e.stopPropagation()}
              >
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  Delete row?
                </span>
                <button
                  type="button"
                  disabled={state === "deleting"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setKebab((prev) => ({ ...prev, [pos.id]: "deleting" }));
                    void onDeletePosition(pos)
                      .then(() => {
                        setKebab((prev) => ({ ...prev, [pos.id]: "closed" }));
                      })
                      .catch(() => {
                        // Failed delete: drop back to "confirm" so the user
                        // can retry rather than silently leaving the row in
                        // the "deleting…" state forever.
                        setKebab((prev) => ({ ...prev, [pos.id]: "confirm" }));
                      });
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: state === "deleting" ? "default" : "pointer",
                    color: T.loss,
                    fontSize: 11,
                    fontFamily: T.fontMono,
                    padding: "0 2px",
                  }}
                >
                  {state === "deleting" ? "deleting…" : "yes, delete"}
                </button>
                <button
                  type="button"
                  disabled={state === "deleting"}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeKebab(pos.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: state === "deleting" ? "default" : "pointer",
                    color: T.text3,
                    fontSize: 11,
                    fontFamily: T.fontMono,
                    padding: "0 2px",
                  }}
                >
                  cancel
                </button>
              </span>
            );
          }
          if (state === "menu") {
            return (
              <span
                data-kebab-menu
                style={{ position: "relative", display: "inline-block" }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeKebab(pos.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: T.text,
                    fontSize: 16,
                    padding: "0 4px",
                  }}
                >
                  ⋮
                </button>
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    background: T.surface,
                    border: `1px solid ${T.outlineFaint}`,
                    borderRadius: 4,
                    zIndex: 10,
                    minWidth: 110,
                    boxShadow: `0 4px 12px rgba(0,0,0,0.15)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setKebab({});
                      onRowClick(pos);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: T.text,
                      fontSize: 12,
                      fontFamily: T.fontSans,
                      padding: "8px 12px",
                    }}
                  >
                    Close…
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setKebab((prev) => ({ ...prev, [pos.id]: "confirm" }));
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: T.loss,
                      fontSize: 12,
                      fontFamily: T.fontSans,
                      padding: "8px 12px",
                    }}
                  >
                    Delete row
                  </button>
                </div>
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openKebab(pos.id);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: T.text3,
                fontSize: 16,
                padding: "0 4px",
              }}
            >
              ⋮
            </button>
          );
        }
        return cell as ReactNode;
      }}
    />
  );
}

function ClosedTable({
  rows,
  onDeleteTrade,
}: {
  rows: ClosedTrade[];
  onDeleteTrade: (trade: ClosedTrade) => Promise<void>;
}) {
  const T = useT();
  const [kebab, setKebab] = useState<Record<string, KebabState>>({});

  function openKebab(id: string) {
    setKebab({ [id]: "menu" });
  }
  function closeKebab(id: string) {
    setKebab((prev) => ({ ...prev, [id]: "closed" }));
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target?.closest("[data-kebab-menu]")) {
        setKebab({});
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const cols: Col[] = [
    { label: "symbol", width: "90px", primary: true },
    { label: "qty", align: "right", width: "80px" },
    { label: "entry", align: "right", width: "90px" },
    { label: "exit", align: "right", width: "90px" },
    { label: "pnl", align: "right", width: "120px" },
    { label: "return", align: "right", width: "90px" },
    { label: "closed", width: "90px" },
    { label: "reason", width: "1fr", mono: false, mobileFullWidth: true },
    { label: "", width: "40px", hideOnMobile: true },
  ];
  const tableRows: unknown[][] = rows.map((c, ri) => [
    c.sym,
    c.qty,
    c.entry,
    c.exit,
    c.pnl,
    c.ret,
    c.date,
    c.reason,
    c,
  ]);
  if (!rows.length) {
    return (
      <div
        style={{
          padding: "22px 0",
          fontSize: 12.5,
          color: T.text3,
          fontStyle: "italic",
          borderTop: `1px solid ${T.outlineFaint}`,
          borderBottom: `1px solid ${T.outlineFaint}`,
        }}
      >
        No closed trades yet.
      </div>
    );
  }
  return (
    <TerminalTable
      cols={cols}
      rows={tableRows}
      renderCell={(cell, ci, ri) => {
        if (ci === 0)
          return <span style={{ color: T.text2, fontWeight: 500 }}>{cell as ReactNode}</span>;
        if (ci === 1) return <span style={{ color: T.text3 }}>{(cell as number).toLocaleString()}</span>;
        if (ci === 2 || ci === 3)
          return <span style={{ color: T.text2 }}>{(cell as number).toFixed(2)}</span>;
        if (ci === 4) {
          const n = cell as number;
          return (
            <span style={{ color: n >= 0 ? T.gain : T.loss }}>
              {n >= 0 ? "+" : ""}
              {n.toLocaleString()}
            </span>
          );
        }
        if (ci === 5) {
          const n = cell as number;
          return (
            <span style={{ color: n >= 0 ? T.gain : T.loss }}>
              {n >= 0 ? "+" : ""}
              {n.toFixed(1)}%
            </span>
          );
        }
        if (ci === 6) return <span style={{ color: T.text3 }}>{cell as ReactNode}</span>;
        if (ci === 7) {
          const s = String(cell);
          const c = s.includes("Stop") ? T.loss : s.includes("Target") ? T.gain : T.text2;
          return <span style={{ color: c }}>{s}</span>;
        }
        if (ci === 8) {
          const trade = cell as ClosedTrade;
          const state = kebab[trade.id] ?? "closed";
          if (state === "confirm" || state === "deleting") {
            return (
              <span
                data-kebab-menu
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={(e) => e.stopPropagation()}
              >
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  Delete row?
                </span>
                <button
                  type="button"
                  disabled={state === "deleting"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setKebab((prev) => ({ ...prev, [trade.id]: "deleting" }));
                    void onDeleteTrade(trade)
                      .then(() => {
                        setKebab((prev) => ({ ...prev, [trade.id]: "closed" }));
                      })
                      .catch(() => {
                        // Failed delete: drop back to "confirm" so the user
                        // can retry rather than silently leaving the row in
                        // the "deleting…" state forever.
                        setKebab((prev) => ({ ...prev, [trade.id]: "confirm" }));
                      });
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: state === "deleting" ? "default" : "pointer",
                    color: T.loss,
                    fontSize: 11,
                    fontFamily: T.fontMono,
                    padding: "0 2px",
                  }}
                >
                  {state === "deleting" ? "deleting…" : "yes, delete"}
                </button>
                <button
                  type="button"
                  disabled={state === "deleting"}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeKebab(trade.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: state === "deleting" ? "default" : "pointer",
                    color: T.text3,
                    fontSize: 11,
                    fontFamily: T.fontMono,
                    padding: "0 2px",
                  }}
                >
                  cancel
                </button>
              </span>
            );
          }
          if (state === "menu") {
            return (
              <span
                data-kebab-menu
                style={{ position: "relative", display: "inline-block" }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeKebab(trade.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: T.text,
                    fontSize: 16,
                    padding: "0 4px",
                  }}
                >
                  ⋮
                </button>
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    background: T.surface,
                    border: `1px solid ${T.outlineFaint}`,
                    borderRadius: 4,
                    zIndex: 10,
                    minWidth: 110,
                    boxShadow: `0 4px 12px rgba(0,0,0,0.15)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setKebab((prev) => ({ ...prev, [trade.id]: "confirm" }));
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: T.loss,
                      fontSize: 12,
                      fontFamily: T.fontSans,
                      padding: "8px 12px",
                    }}
                  >
                    Delete row
                  </button>
                </div>
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openKebab(trade.id);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: T.text3,
                fontSize: 16,
                padding: "0 4px",
              }}
            >
              ⋮
            </button>
          );
        }
        return cell as ReactNode;
      }}
    />
  );
}

/* ────────── Flash ────────── */

function FlashBar({ message }: { message: string }) {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  return (
    <div
      style={{
        padding: `8px ${padX}`,
        background: T.primary + "18",
        borderBottom: `1px solid ${T.primary}33`,
        fontFamily: T.fontMono,
        fontSize: 11.5,
        color: T.primaryLight,
        letterSpacing: 0.3,
      }}
    >
      ✓ {message}
    </div>
  );
}

/* ────────── Log Trade Modal ────────── */

function LogTradeModal({
  onClose,
  onSubmit,
  symbolOptions,
  strategyOptions,
}: {
  onClose: () => void;
  onSubmit: (p: Omit<OpenPosition, "id">) => Promise<boolean>;
  symbolOptions: SymbolOption[];
  strategyOptions: StrategyOption[];
}) {
  const T = useT();
  const [sym, setSym] = useState("");

  const symbolCombo: ComboOption[] = useMemo(
    () =>
      symbolOptions.map((s) => ({
        value: s.symbol,
        label: s.symbol,
        keywords: s.name ?? "",
        hint: s.name ?? undefined,
      })),
    [symbolOptions],
  );

  const strategyCombo: ComboOption[] = useMemo(
    () =>
      strategyOptions.map((s) => ({
        value: s.name,
        label: s.name,
        hint: s.status === "ACTIVE" ? "active" : s.status.toLowerCase(),
      })),
    [strategyOptions],
  );

  const [qty, setQty] = useState("");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [source, setSource] = useState<TradeSource>("manual");
  const [strat, setStrat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const qtyN = Number(qty);
  const entryN = Number(entry);
  const stopN = Number(stop);
  const targetN = Number(target);
  const notional = qtyN && entryN ? qtyN * entryN : 0;
  const riskPct =
    stopN && entryN ? ((entryN - stopN) / entryN) * 100 : 0;
  const rewardPct =
    targetN && entryN ? ((targetN - entryN) / entryN) * 100 : 0;

  async function submit() {
    if (!sym.trim()) return setError("Symbol is required");
    if (!qtyN || qtyN <= 0) return setError("Quantity must be > 0");
    if (!entryN || entryN <= 0) return setError("Entry price must be > 0");
    if (stopN && stopN >= entryN) return setError("Stop must be below entry");
    if (targetN && targetN <= entryN) return setError("Target must be above entry");
    if (source === "signal" && !strat.trim()) return setError("Strategy is required for signal trades");
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        sym: sym.trim().toUpperCase(),
        qty: Math.round(qtyN),
        entry: Number(entryN.toFixed(2)),
        now: Number(entryN.toFixed(2)),
        source,
        strat: source === "signal" ? strat.trim() : null,
        date: todayLabel(),
        stop: stopN ? Number(stopN.toFixed(2)) : 0,
        target: targetN ? Number(targetN.toFixed(2)) : 0,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} width={600} label="Log manual trade">
      <div style={{ padding: "22px 26px 10px" }}>
        <Kicker color={T.primaryLight}>log manual trade to ledger</Kicker>
        <h2
          style={{
            fontFamily: T.fontHead,
            fontSize: 26,
            fontWeight: 500,
            margin: "10px 0 4px",
            letterSpacing: -0.5,
          }}
        >
          New position
        </h2>
        <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
          fill in what you actually bought — no broker sync
        </div>
      </div>

      <div style={{ padding: "14px 26px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Combobox
            label="Symbol"
            value={sym}
            onChange={setSym}
            options={symbolCombo}
            placeholder="OGDC"
            transform={(v) => v.toUpperCase()}
            mono
            emptyHint="No match — will submit as typed"
          />
          <ModalInput
            label="Quantity"
            value={qty}
            onChange={setQty}
            placeholder="1000"
            suffix="sh"
            type="number"
            mono
          />
          <ModalInput
            label="Entry price"
            value={entry}
            onChange={setEntry}
            placeholder="118.40"
            suffix="PKR"
            type="number"
            mono
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <ModalInput
            label="Stop loss"
            value={stop}
            onChange={setStop}
            placeholder="optional"
            suffix={stopN && entryN ? `${riskPct >= 0 ? "−" : "+"}${Math.abs(riskPct).toFixed(1)}%` : "PKR"}
            type="number"
            mono
          />
          <ModalInput
            label="Take profit"
            value={target}
            onChange={setTarget}
            placeholder="optional"
            suffix={targetN && entryN ? `+${rewardPct.toFixed(1)}%` : "PKR"}
            type="number"
            mono
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <Kicker>Source</Kicker>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <SourcePill
              active={source === "manual"}
              onClick={() => setSource("manual")}
              label="Manual"
              sub="discretionary"
            />
            <SourcePill
              active={source === "signal"}
              onClick={() => setSource("signal")}
              label="Signal"
              sub="from a strategy"
              accent
            />
          </div>
        </div>

        {source === "signal" && (
          <div style={{ marginTop: 10 }}>
            <Combobox
              label="Strategy name"
              value={strat}
              onChange={setStrat}
              options={strategyCombo}
              placeholder="RSI Bounce v1"
              emptyHint={
                strategyOptions.length === 0
                  ? "No strategies yet — type a name to log freely"
                  : "No match — will submit as typed"
              }
            />
          </div>
        )}

        {qtyN > 0 && entryN > 0 && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: T.surface,
              borderRadius: 8,
              boxShadow: `0 0 0 1px ${T.outlineFaint}`,
            }}
          >
            <DotRow label="Notional" value={`PKR ${notional.toLocaleString()}`} bold />
            {stopN > 0 && (
              <DotRow
                label="Risk per share"
                value={`PKR ${(entryN - stopN).toFixed(2)} (${riskPct.toFixed(1)}%)`}
              />
            )}
            {targetN > 0 && stopN > 0 && (
              <DotRow
                label="R:R"
                value={`${((targetN - entryN) / (entryN - stopN)).toFixed(2)} : 1`}
              />
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              background: T.loss + "12",
              border: `1px solid ${T.loss}44`,
              borderRadius: 6,
              color: T.loss,
              fontFamily: T.fontMono,
              fontSize: 11.5,
            }}
          >
            ! {error}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 16,
          borderTop: `1px solid ${T.outlineFaint}`,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <Btn variant="outline" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Btn>
        <Btn variant="primary" size="sm" icon={Icon.check} onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Log to portfolio →"}
        </Btn>
      </div>
    </Modal>
  );
}

/* ────────── Close Position Modal ────────── */

function ClosePositionModal({
  position,
  onClose,
  onSubmit,
}: {
  position: OpenPosition;
  onClose: () => void;
  onSubmit: (p: OpenPosition, exit: number, reason: CloseReason) => Promise<boolean>;
}) {
  const T = useT();
  // Default the exit field to the latest known price; if the row has no
  // current_price (unpriced), fall back to entry so the user has a
  // sensible numeric starting point and can edit before submitting.
  const [exit, setExit] = useState(
    (position.now ?? position.entry).toFixed(2),
  );
  const [reason, setReason] = useState<CloseReason>("Manual close");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const exitN = Number(exit);
  const pnl = exitN ? Math.round((exitN - position.entry) * position.qty) : 0;
  const ret = exitN ? ((exitN - position.entry) / position.entry) * 100 : 0;
  const proceeds = exitN ? exitN * position.qty : 0;

  async function submit() {
    if (!exitN || exitN <= 0) return setError("Exit price must be > 0");
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(position, Number(exitN.toFixed(2)), reason);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} width={540} label="Close position">
      <div style={{ padding: "22px 26px 10px" }}>
        <Kicker color={T.primaryLight}>close position</Kicker>
        <h2
          style={{
            fontFamily: T.fontHead,
            fontSize: 26,
            fontWeight: 500,
            margin: "10px 0 4px",
            letterSpacing: -0.5,
          }}
        >
          <span style={{ fontStyle: "italic", color: T.primaryLight }}>{position.sym}</span> ·{" "}
          sell {position.qty.toLocaleString()}
        </h2>
        <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
          entry {position.entry.toFixed(2)} · opened {position.date} ·{" "}
          {position.source === "signal" ? position.strat ?? "signal" : "manual"}
        </div>
      </div>

      <div style={{ padding: "14px 26px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <ModalInput
            label="Exit price"
            value={exit}
            onChange={setExit}
            placeholder="e.g. 132.60"
            suffix="PKR"
            type="number"
            mono
          />
          <div>
            <Kicker>Reason</Kicker>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {(["Target hit", "Stop loss", "Manual close"] as const).map((r) => {
                const active = reason === r;
                const c =
                  r === "Target hit" ? T.gain : r === "Stop loss" ? T.loss : T.text2;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    style={{
                      padding: "6px 10px",
                      fontSize: 11.5,
                      fontFamily: T.fontSans,
                      borderRadius: 4,
                      border: `1px solid ${active ? c : T.outlineFaint}`,
                      background: active ? c + "18" : "transparent",
                      color: active ? c : T.text2,
                      cursor: "pointer",
                    }}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: T.surface,
            borderRadius: 8,
            boxShadow: `0 0 0 1px ${T.outlineFaint}`,
          }}
        >
          <DotRow label="Proceeds" value={`PKR ${proceeds.toLocaleString()}`} />
          <DotRow
            label="Realized P&L"
            value={
              <span style={{ color: pnl >= 0 ? T.gain : T.loss }}>
                {pnl >= 0 ? "+" : ""}
                {pnl.toLocaleString()} ({ret >= 0 ? "+" : ""}
                {ret.toFixed(2)}%)
              </span>
            }
            bold
            color={pnl >= 0 ? T.gain : T.loss}
          />
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              background: T.loss + "12",
              border: `1px solid ${T.loss}44`,
              borderRadius: 6,
              color: T.loss,
              fontFamily: T.fontMono,
              fontSize: 11.5,
            }}
          >
            ! {error}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 16,
          borderTop: `1px solid ${T.outlineFaint}`,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <Btn variant="outline" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Btn>
        <Btn variant="primary" size="sm" icon={Icon.check} onClick={submit} disabled={submitting}>
          {submitting ? "Closing…" : "Close position →"}
        </Btn>
      </div>
    </Modal>
  );
}

/* ────────── Modal fields ────────── */

function ModalInput({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  type = "text",
  mono,
  transform,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  type?: "text" | "number";
  mono?: boolean;
  transform?: (v: string) => string;
}) {
  const T = useT();
  const boxStyle: CSSProperties = {
    marginTop: 6,
    padding: "8px 12px",
    background: T.surface,
    borderRadius: 8,
    boxShadow: `0 0 0 1px ${T.outlineFaint}`,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  };
  const inputStyle: CSSProperties = {
    background: "transparent",
    border: "none",
    color: T.text,
    fontFamily: mono ? T.fontMono : T.fontSans,
    fontSize: 13,
    width: "100%",
    padding: 0,
  };
  return (
    <div>
      <Kicker>{label}</Kicker>
      <div style={boxStyle}>
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(transform ? transform(e.target.value) : e.target.value)}
          style={inputStyle}
          inputMode={type === "number" ? "decimal" : undefined}
        />
        {suffix && (
          <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.text3, whiteSpace: "nowrap" }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function SourcePill({
  active,
  onClick,
  label,
  sub,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  accent?: boolean;
}) {
  const T = useT();
  const color = accent ? T.deploy : T.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        padding: "10px 12px",
        borderRadius: 8,
        background: active ? color + "14" : "transparent",
        border: `1px solid ${active ? color : T.outlineFaint}`,
        color: active ? color : T.text2,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: T.fontSans,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      <div style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.text3, marginTop: 2 }}>
        {sub}
      </div>
    </button>
  );
}

/* ────────── Empty state ────────── */

function EmptyState({
  onLogClick,
  onImport,
}: {
  onLogClick: () => void;
  onImport: () => void;
}) {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: pick(bp, {
          mobile: `28px ${padX}`,
          desktop: `48px ${padX}`,
        }),
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: pick(bp, {
            mobile: "1fr",
            tablet: "1.3fr 1fr",
            desktop: "1.3fr 1fr",
          }),
          gap: pick(bp, { mobile: 32, tablet: 36, desktop: 48 }),
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div>
          <Kicker>manual ledger</Kicker>
          <h2
            style={{
              fontFamily: T.fontHead,
              fontSize: clampPx(30, 7, 44),
              fontWeight: 500,
              margin: "14px 0 18px",
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
            }}
          >
            Track{" "}
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>
              your actual trades
            </span>
            .
          </h2>
          <p style={{ fontSize: 14, color: T.text2, lineHeight: 1.7, maxWidth: 520 }}>
            No broker connection. You log trades by hand — what you bought, at what price, when. The
            portfolio tracks P&amp;L and shows how signal-driven trades compare to your
            discretionary ones.
          </p>
          <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn variant="primary" size="lg" icon={Icon.plus} onClick={onLogClick}>
              Log a trade
            </Btn>
            <Btn variant="ghost" size="lg" onClick={onImport}>
              Import CSV
            </Btn>
          </div>

          <div style={{ marginTop: 40 }}>
            <Ribbon kicker="why manual?" />
            <div style={{ marginTop: 10, fontSize: 13, color: T.text2, lineHeight: 1.8 }}>
              PSX doesn&apos;t expose broker APIs, so we can&apos;t auto-sync. The upside: you
              decide what counts as a trade and when to log it. The ledger is{" "}
              <em style={{ color: T.text }}>yours</em>.
            </div>
          </div>
        </div>

        <div>
          <Kicker>what you&apos;ll see here</Kicker>
          <div style={{ marginTop: 12 }}>
            <DotRow label="Open positions" value="with live prices" />
            <DotRow label="Unrealized P&L" value="per position" />
            <DotRow label="Realized P&L" value="YTD from closed trades" />
            <DotRow
              label="Signal vs manual"
              value="attribution edge"
              color={T.deploy}
              bold
            />
            <DotRow label="Sector allocation" value="as % of portfolio" />
            <DotRow label="Win rate" value="over all closed trades" />
          </div>
          <div
            style={{
              marginTop: 22,
              padding: 16,
              background: T.surfaceLow,
              borderRadius: 6,
              border: `1px dashed ${T.outlineFaint}`,
            }}
          >
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 10.5,
                color: T.primaryLight,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              tip
            </div>
            <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.55 }}>
              Every signal on the Signals page has a &ldquo;log this trade&rdquo; button — so if you
              follow a{" "}
              <Link href="/signals" style={{ color: T.primaryLight }}>
                signal
              </Link>
              , it lands here auto-tagged as signal-driven.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
