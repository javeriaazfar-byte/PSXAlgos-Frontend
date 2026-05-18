"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppFrame } from "@/components/frame";
import { useT } from "@/components/theme";
import {
  Btn,
  EditorialHeader,
  Kicker,
  Ribbon,
  TerminalTable,
  type Col,
} from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";

export type Status = "DEPLOYED" | "DRAFT" | "PAUSED" | "ARCHIVED";
type StatusFilter = "all" | "deployed" | "draft" | "paused" | "archived";
export type OutputKind = "bt" | "sig" | "bot";
type SortKey = "updated" | "name" | "backtest" | "sharpe" | "today";
type SortDir = "asc" | "desc";

export interface Strategy {
  id: string;
  name: string;
  type: string;
  status: Status;
  signals: number;
  // Number of non-STOPPED bots bound to this strategy. Populated from
  // backend `bots_count` (single-query aggregate); 0 means no live bots.
  botsCount: number;
  bt: string;
  sharpe: number | null;
  outputs: OutputKind[];
  updated: string;
  updatedMin: number;
  // Minutes since the signal scanner last ran this strategy. Used to render
  // the "last scan Xm ago" footer chip. Number.MAX_SAFE_INTEGER means
  // never scanned.
  lastScanMin: number;
  pinned?: boolean;
}

const ARCHIVE_SKIP_KEY = "psx:strategies:skipArchiveConfirm";

const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: "updated", label: "updated", defaultDir: "asc" }, // smallest minutes-ago = most recent
  { key: "name", label: "name", defaultDir: "asc" },
  { key: "backtest", label: "backtest", defaultDir: "desc" },
  { key: "sharpe", label: "sharpe", defaultDir: "desc" },
  { key: "today", label: "signals today", defaultDir: "desc" },
];

function parseBt(s: string): number | null {
  if (!s || s === "—") return null;
  // handles unicode minus "−" and ascii "-"
  const normalized = s.replace("−", "-").replace("%", "").trim();
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function compare(a: Strategy, b: Strategy, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  // pinned rows always float up within the same sort
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name) * sign;
    case "updated":
      return (a.updatedMin - b.updatedMin) * sign;
    case "sharpe": {
      const av = a.sharpe ?? -Infinity;
      const bv = b.sharpe ?? -Infinity;
      return (av - bv) * sign;
    }
    case "backtest": {
      const av = parseBt(a.bt) ?? -Infinity;
      const bv = parseBt(b.bt) ?? -Infinity;
      return (av - bv) * sign;
    }
    case "today":
      return (a.signals - b.signals) * sign;
  }
}

export function StrategiesView({
  initialStrategies,
  fetchFailed = false,
}: {
  initialStrategies: Strategy[];
  fetchFailed?: boolean;
}) {
  const [rows, setRows] = useState<Strategy[]>(initialStrategies);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [importMsg, setImportMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Strategy | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  // Whether the user has opted out of the archive-confirm modal. Read from
  // localStorage once on mount; the modal still appears unconditionally when
  // live bots are bound (the bot-warning panel is load-bearing).
  const [skipArchiveConfirm, setSkipArchiveConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setSkipArchiveConfirm(localStorage.getItem(ARCHIVE_SKIP_KEY) === "1");
    } catch {
      // Private mode / storage disabled — keep default (show modal).
    }
  }, []);

  // Surface server-side fetch failure as a toast on mount so an empty list
  // isn't misread as "no strategies yet" when it's actually a backend failure.
  useEffect(() => {
    if (fetchFailed) {
      setImportMsg({
        kind: "err",
        text: "Couldn't load your strategies — showing partial data",
      });
    }
  }, [fetchFailed]);

  // Status patch via PUT /api/strategies/{id}. Backend allows transitions
  // to ARCHIVED unconditionally (no actionable-rule check at routers/strategies.py:649),
  // and DRAFT is the safe "back to authoring" state when restoring.
  async function patchStatus(s: Strategy, next: Status): Promise<void> {
    const res = await fetch(`/api/strategies/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next === "DEPLOYED" ? "ACTIVE" : next }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
  }

  async function performArchive(s: Strategy) {
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      await patchStatus(s, "ARCHIVED");
      setRows((prev) => prev.map((r) => (r.id === s.id ? { ...r, status: "ARCHIVED" } : r)));
      setImportMsg({ kind: "ok", text: `archived "${s.name}"` });
      setArchiveTarget(null);
    } catch (err) {
      setImportMsg({ kind: "err", text: err instanceof Error ? err.message : "archive failed" });
    } finally {
      setArchiveBusy(false);
    }
  }

  async function performRestore(s: Strategy) {
    if (restoreBusyId) return;
    setRestoreBusyId(s.id);
    try {
      await patchStatus(s, "DRAFT");
      setRows((prev) => prev.map((r) => (r.id === s.id ? { ...r, status: "DRAFT" } : r)));
      setImportMsg({ kind: "ok", text: `restored "${s.name}"` });
    } catch (err) {
      setImportMsg({ kind: "err", text: err instanceof Error ? err.message : "restore failed" });
    } finally {
      setRestoreBusyId(null);
    }
  }

  useEffect(() => {
    if (!importMsg) return;
    const t = setTimeout(() => setImportMsg(null), 4000);
    return () => clearTimeout(t);
  }, [importMsg]);

  function onImportClick() {
    fileRef.current?.click();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const imported: Strategy[] = list.map((raw, i) => coerceStrategy(raw, i));
      // Compute skipped/added inside the functional setRows updater so dedup
      // reads against the current row set, not the closure's snapshot. Two
      // imports fired back-to-back, or an archive between file selections,
      // would otherwise produce a wrong "skipped N duplicates" toast.
      let added = 0;
      let skipped = 0;
      setRows((prev) => {
        const prevIds = new Set(prev.map((r) => r.id));
        const fresh = imported.filter((r) => !prevIds.has(r.id));
        added = fresh.length;
        skipped = imported.length - added;
        return [...fresh, ...prev];
      });
      const msg = skipped > 0 ? `imported ${added} · skipped ${skipped} duplicate` : `imported ${added}`;
      setImportMsg({ kind: "ok", text: msg });
    } catch (err) {
      setImportMsg({ kind: "err", text: err instanceof Error ? err.message : "invalid JSON" });
    }
  }

  return (
    <AppFrame route="/strategies">
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={onImportFile}
      />
      <ListBody
        rows={rows}
        status={status}
        setStatus={setStatus}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => {
          setSortKey(k);
          setSortDir(d);
        }}
        onImport={onImportClick}
        importMsg={importMsg}
        onArchive={(s) => {
          // Bypass the modal only when the user has opted out AND no live
          // bots are bound. The bot-warning panel must never be silently
          // suppressed — that's the whole reason the modal exists.
          if (skipArchiveConfirm && s.botsCount === 0) {
            void performArchive(s);
            return;
          }
          setArchiveTarget(s);
        }}
        onRestore={performRestore}
        restoreBusyId={restoreBusyId}
        archiveBusy={archiveBusy}
        archiveBusyId={archiveTarget?.id ?? null}
      />
      {archiveTarget && (
        <ArchiveConfirmModal
          strategy={archiveTarget}
          busy={archiveBusy}
          skipConfirm={skipArchiveConfirm}
          onSkipConfirmChange={(v) => {
            setSkipArchiveConfirm(v);
            try {
              if (v) localStorage.setItem(ARCHIVE_SKIP_KEY, "1");
              else localStorage.removeItem(ARCHIVE_SKIP_KEY);
            } catch {
              // Storage disabled — preference still applies in-session.
            }
          }}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => performArchive(archiveTarget)}
        />
      )}
    </AppFrame>
  );
}

function ListBody({
  rows,
  status,
  setStatus,
  sortKey,
  sortDir,
  onSort,
  onImport,
  importMsg,
  onArchive,
  onRestore,
  restoreBusyId,
  archiveBusy,
  archiveBusyId,
}: {
  rows: Strategy[];
  status: StatusFilter;
  setStatus: (s: StatusFilter) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey, d: SortDir) => void;
  onImport: () => void;
  importMsg: { kind: "ok" | "err"; text: string } | null;
  onArchive: (s: Strategy) => void;
  onRestore: (s: Strategy) => void;
  restoreBusyId: string | null;
  archiveBusy: boolean;
  archiveBusyId: string | null;
}) {
  const T = useT();
  const source = rows;
  const isEmpty = rows.length === 0;

  // "Active" rows = everything except ARCHIVED. The "all" pill and all
  // summary aggregates (counts, signals today, bots bound, last-scan) work
  // off this so archived strategies stay out of the live dashboard view —
  // they're only reachable via the explicit "archived" filter.
  const liveRows = useMemo(
    () => source.filter((r) => r.status !== "ARCHIVED"),
    [source]
  );

  const counts = useMemo(() => {
    const c = { all: liveRows.length, deployed: 0, draft: 0, paused: 0, archived: 0 };
    for (const r of source) {
      if (r.status === "DEPLOYED") c.deployed++;
      else if (r.status === "DRAFT") c.draft++;
      else if (r.status === "PAUSED") c.paused++;
      else if (r.status === "ARCHIVED") c.archived++;
    }
    return c;
  }, [source, liveRows]);

  const signalsToday = useMemo(
    () => liveRows.reduce((acc, r) => acc + r.signals, 0),
    [liveRows]
  );
  // Sum per-row botsCount (the real backend aggregate). Previously this
  // counted strategies that had any bot, not the actual number of bots —
  // and even that was structurally broken because outputs never included
  // "bot". Now it matches what the user sees in the bots dashboard.
  const botsBound = useMemo(
    () => liveRows.reduce((acc, r) => acc + (r.botsCount ?? 0), 0),
    [liveRows]
  );

  // Most recent scan across active strategies. Number.MAX_SAFE_INTEGER means
  // no strategy has ever been scanned. Archived strategies are skipped — they
  // don't scan, so their lastScanMin would just stale the readout.
  const lastScanLabel = useMemo(() => {
    if (liveRows.length === 0) return "no scans yet";
    const min = Math.min(...liveRows.map((r) => r.lastScanMin));
    if (min === Number.MAX_SAFE_INTEGER) return "no scans yet";
    if (min < 1) return "last scan just now";
    if (min < 60) return `last scan ${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `last scan ${h}h ago`;
    const d = Math.floor(h / 24);
    return `last scan ${d}d ago`;
  }, [liveRows]);

  const filtered = useMemo(() => {
    // "all" excludes archived — those are only reachable via the explicit
    // "archived" pill so cleaning the dashboard actually cleans it.
    if (status === "all") return liveRows;
    const match: Status = status.toUpperCase() as Status;
    return source.filter((r) => r.status === match);
  }, [source, liveRows, status]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => compare(a, b, sortKey, sortDir));
    return copy;
  }, [filtered, sortKey, sortDir]);

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "all", count: counts.all },
    { key: "deployed", label: "deployed", count: counts.deployed },
    { key: "draft", label: "draft", count: counts.draft },
    { key: "paused", label: "paused", count: counts.paused },
    { key: "archived", label: "archived", count: counts.archived },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <EditorialHeader
        kicker="Authoring · strategy is the unit of work"
        title={
          <>
            Strategies{" "}
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>·</span>{" "}
            {isEmpty ? (
              <span style={{ color: T.text3, fontWeight: 400, fontSize: "0.7em" }}>
                you haven&apos;t built one yet
              </span>
            ) : (
              `${counts.all} total`
            )}
          </>
        }
        meta={
          isEmpty ? (
            <>
              <span>0 deployed</span>
              <span>0 signals today</span>
              <span>0 bots</span>
            </>
          ) : (
            <>
              <span>
                <span style={{ color: T.gain }}>●</span> {counts.deployed} deployed
              </span>
              <span>
                {signalsToday} {signalsToday === 1 ? "signal" : "signals"} today
              </span>
              <span>
                {botsBound} {botsBound === 1 ? "bot" : "bots"} bound
              </span>
              <span style={{ color: T.text3 }}>{lastScanLabel}</span>
            </>
          )
        }
        actions={
          <>
            {importMsg && (
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: importMsg.kind === "ok" ? T.gain : T.loss,
                }}
              >
                {importMsg.text}
              </span>
            )}
            <Btn variant="ghost" size="sm" onClick={onImport}>
              Import JSON
            </Btn>
            <Link href="/strategies/new" style={{ textDecoration: "none" }}>
              <Btn variant="primary" size="sm" icon={Icon.plus}>
                New strategy
              </Btn>
            </Link>
          </>
        }
      />

      {isEmpty ? (
        <EmptyState onImport={onImport} />
      ) : (
        <FilteredList
          filters={filters}
          status={status}
          setStatus={setStatus}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          sorted={sorted}
          onArchive={onArchive}
          onRestore={onRestore}
          restoreBusyId={restoreBusyId}
          archiveBusy={archiveBusy}
          archiveBusyId={archiveBusyId}
        />
      )}
    </div>
  );
}

function FilteredList({
  filters,
  status,
  setStatus,
  sortKey,
  sortDir,
  onSort,
  sorted,
  onArchive,
  onRestore,
  restoreBusyId,
  archiveBusy,
  archiveBusyId,
}: {
  filters: { key: StatusFilter; label: string; count: number }[];
  status: StatusFilter;
  setStatus: (s: StatusFilter) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey, d: SortDir) => void;
  sorted: Strategy[];
  onArchive: (s: Strategy) => void;
  onRestore: (s: Strategy) => void;
  restoreBusyId: string | null;
  archiveBusy: boolean;
  archiveBusyId: string | null;
}) {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  return (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: pick(bp, {
              mobile: `16px ${padX} 28px`,
              desktop: `20px ${padX} 40px`,
            }),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: isMobile ? "stretch" : "center",
              gap: isMobile ? 10 : 18,
              paddingBottom: 14,
              borderBottom: `1px solid ${T.outlineFaint}`,
              flexDirection: isMobile ? "column" : "row",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                rowGap: 8,
              }}
            >
              <Kicker>filter</Kicker>
              {filters.map((f) => {
                const active = status === f.key;
                return (
                  <FilterPill
                    key={f.key}
                    active={active}
                    onClick={() => setStatus(f.key)}
                    disabled={f.count === 0 && f.key !== "all"}
                  >
                    {f.label} {f.count}
                  </FilterPill>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            <SortControl
              sortKey={sortKey}
              sortDir={sortDir}
              onChange={(k, d) => onSort(k, d)}
            />
          </div>

          <div style={{ marginTop: 18 }}>
            {sorted.length === 0 ? (
              <FilteredEmpty
                onReset={() => setStatus("all")}
                label={filters.find((f) => f.key === status)?.label ?? "this filter"}
                archivedCount={
                  status === "all"
                    ? filters.find((f) => f.key === "archived")?.count ?? 0
                    : 0
                }
                onShowArchived={() => setStatus("archived")}
              />
            ) : (
              <StrategyTable
                rows={sorted}
                onArchive={onArchive}
                onRestore={onRestore}
                restoreBusyId={restoreBusyId}
                archiveBusy={archiveBusy}
                archiveBusyId={archiveBusyId}
              />
            )}
          </div>
        </div>
  );
}

function FilterPill({
  children,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const T = useT();
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 11.5,
        fontFamily: T.fontMono,
        background: active ? T.surface3 : "transparent",
        color: active ? T.text : disabled ? T.text3 : T.text2,
        boxShadow: `0 0 0 1px ${active ? T.outlineVariant : T.outlineFaint}`,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

function SortControl({
  sortKey,
  sortDir,
  onChange,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onChange: (k: SortKey, d: SortDir) => void;
}) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = SORT_OPTIONS.find((o) => o.key === sortKey) ?? SORT_OPTIONS[0];
  const arrow = sortDir === "asc" ? "↑" : "↓";
  // "updated" uses minutes-ago numbers where asc = most recent first, so flip visible arrow
  const displayArrow = sortKey === "updated" ? (sortDir === "asc" ? "↓" : "↑") : arrow;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          fontFamily: T.fontMono,
          fontSize: 11,
          color: T.text3,
          background: open ? T.surface3 : "transparent",
          border: "none",
          boxShadow: `0 0 0 1px ${open ? T.outlineVariant : "transparent"}`,
          borderRadius: 4,
          padding: "4px 8px",
          cursor: "pointer",
        }}
        aria-expanded={open}
      >
        sort:{" "}
        <span style={{ color: T.text2 }}>
          {current.label} {displayArrow}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 200,
            background: T.surface2,
            border: `1px solid ${T.outlineVariant}`,
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 20,
            padding: 4,
            fontFamily: T.fontMono,
            fontSize: 11.5,
          }}
        >
          {SORT_OPTIONS.map((opt) => {
            const selected = opt.key === sortKey;
            const shownArrow =
              opt.key === "updated"
                ? sortDir === "asc"
                  ? "↓"
                  : "↑"
                : sortDir === "asc"
                ? "↑"
                : "↓";
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  if (selected) {
                    onChange(opt.key, sortDir === "asc" ? "desc" : "asc");
                  } else {
                    onChange(opt.key, opt.defaultDir);
                  }
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "7px 10px",
                  background: selected ? T.surface3 : "transparent",
                  color: selected ? T.text : T.text2,
                  border: "none",
                  borderRadius: 4,
                  fontFamily: T.fontMono,
                  fontSize: 11.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>{opt.label}</span>
                <span style={{ color: selected ? T.primaryLight : T.text3 }}>
                  {selected ? shownArrow : " "}
                </span>
              </button>
            );
          })}
          <div style={{ height: 1, background: T.outlineFaint, margin: "4px 0" }} />
          <div style={{ padding: "4px 10px 6px", color: T.text3, fontSize: 10.5 }}>
            click active row to flip direction
          </div>
        </div>
      )}
    </div>
  );
}

function FilteredEmpty({
  onReset,
  label,
  archivedCount,
  onShowArchived,
}: {
  onReset: () => void;
  label: string;
  // When > 0, the user is on the "all" pill and every strategy they own is
  // archived. Show a nudge to the archived pill instead of a useless
  // "clear filter" CTA (which would just re-select "all").
  archivedCount?: number;
  onShowArchived?: () => void;
}) {
  const T = useT();
  const allArchived = (archivedCount ?? 0) > 0;
  return (
    <div
      style={{
        padding: "48px 20px",
        textAlign: "center",
        color: T.text3,
        fontFamily: T.fontMono,
        fontSize: 12,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        {allArchived ? (
          <>
            all {archivedCount} of your strategies are{" "}
            <span style={{ color: T.text2 }}>archived</span>
          </>
        ) : (
          <>
            no strategies match <span style={{ color: T.text2 }}>{label}</span>
          </>
        )}
      </div>
      {allArchived && onShowArchived ? (
        <Btn variant="ghost" size="sm" onClick={onShowArchived}>
          view archived
        </Btn>
      ) : (
        <Btn variant="ghost" size="sm" onClick={onReset}>
          clear filter
        </Btn>
      )}
    </div>
  );
}

function coerceStrategy(raw: unknown, idx: number): Strategy {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name.trim() ? r.name : `Imported ${idx + 1}`;
  const id =
    typeof r.id === "string" && r.id
      ? r.id
      : name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const statusRaw = typeof r.status === "string" ? r.status.toUpperCase() : "DRAFT";
  const status: Status = (["DEPLOYED", "DRAFT", "PAUSED", "ARCHIVED"] as const).includes(
    statusRaw as Status
  )
    ? (statusRaw as Status)
    : "DRAFT";
  const outputs = Array.isArray(r.outputs)
    ? (r.outputs.filter((o): o is OutputKind => o === "bt" || o === "sig" || o === "bot"))
    : [];
  return {
    id,
    name,
    type: typeof r.type === "string" ? r.type : "Custom",
    status,
    signals: typeof r.signals === "number" ? r.signals : 0,
    botsCount: typeof r.botsCount === "number" ? r.botsCount : 0,
    bt: typeof r.bt === "string" ? r.bt : "—",
    sharpe: typeof r.sharpe === "number" ? r.sharpe : null,
    outputs,
    updated: "just now",
    updatedMin: 0,
    lastScanMin: Number.MAX_SAFE_INTEGER,
    pinned: r.pinned === true,
  };
}

function StrategyTable({
  rows,
  onArchive,
  onRestore,
  restoreBusyId,
  archiveBusy,
  archiveBusyId,
}: {
  rows: Strategy[];
  onArchive: (s: Strategy) => void;
  onRestore: (s: Strategy) => void;
  restoreBusyId: string | null;
  archiveBusy: boolean;
  archiveBusyId: string | null;
}) {
  const T = useT();
  const cols: Col[] = [
    { label: "name", width: "1.5fr", mono: false, primary: true },
    { label: "type", width: "140px", mono: false },
    { label: "status", width: "110px" },
    { label: "backtest", align: "right", width: "90px" },
    { label: "sharpe", align: "right", width: "70px" },
    { label: "outputs", width: "120px", mobileFullWidth: true },
    { label: "today", align: "right", width: "80px" },
    { label: "updated", align: "right", width: "90px" },
    // Empty-label column auto-flags as mobileFullWidth (see Col docs);
    // on desktop renders an Archive / Restore action per row.
    { label: "", align: "right", width: "90px" },
  ];
  const glyphs: Record<OutputKind, [string, string, string]> = {
    bt: ["⎈", T.primary, "Backtest"],
    sig: ["◉", T.deploy, "Signals"],
    bot: ["◇", T.accent, "Bot"],
  };
  const tableRows: unknown[][] = rows.map((s) => [
    s,
    s.type,
    s.status,
    s.bt,
    s.sharpe,
    s.outputs,
    s.signals,
    s.updated,
    s,
  ]);
  return (
    <TerminalTable
      cols={cols}
      rows={tableRows}
      renderCell={(cell, ci) => {
        if (ci === 0) {
          const s = cell as Strategy;
          return (
            <Link href={`/strategies/${s.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
              <span
                style={{
                  fontFamily: T.fontHead,
                  fontSize: 14,
                  color: T.text,
                  fontWeight: 500,
                  letterSpacing: -0.2,
                }}
              >
                {s.name}
              </span>
              {s.pinned && <span style={{ color: T.accent, fontSize: 10 }}>★</span>}
            </Link>
          );
        }
        if (ci === 1) return <span style={{ color: T.text2 }}>{cell as string}</span>;
        if (ci === 2) {
          const st = cell as Status;
          const c = { DEPLOYED: T.deploy, DRAFT: T.text3, PAUSED: T.warning, ARCHIVED: T.text3 }[st];
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: c,
                fontSize: 10.5,
                letterSpacing: 0.6,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  background: c,
                  boxShadow: st === "DEPLOYED" ? `0 0 0 2px ${c}33` : undefined,
                }}
              />
              {st.toLowerCase()}
            </span>
          );
        }
        if (ci === 3) {
          const str = String(cell);
          if (str === "—") return <span style={{ color: T.text3 }}>{str}</span>;
          return <span style={{ color: str.startsWith("+") ? T.gain : T.loss }}>{str}</span>;
        }
        if (ci === 4)
          return cell == null ? (
            <span style={{ color: T.text3 }}>—</span>
          ) : (
            <span style={{ color: T.text2 }}>{(cell as number).toFixed(2)}</span>
          );
        if (ci === 5) {
          const outs = cell as OutputKind[];
          return (
            <span style={{ display: "inline-flex", gap: 5 }}>
              {outs.length === 0 ? (
                <span style={{ color: T.text3, fontSize: 10.5 }}>—</span>
              ) : (
                outs.map((o, i) => {
                  const [g, c, title] = glyphs[o];
                  return (
                    <span
                      key={i}
                      title={title}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: c + "22",
                        color: c,
                        fontFamily: T.fontHead,
                        fontSize: 11,
                      }}
                    >
                      {g}
                    </span>
                  );
                })
              )}
            </span>
          );
        }
        if (ci === 6) {
          const n = cell as number;
          return (
            <span style={{ color: n > 0 ? T.text : T.text3, fontWeight: n > 0 ? 600 : 400 }}>
              {n || "—"}
            </span>
          );
        }
        if (ci === 7) return <span style={{ color: T.text3 }}>{cell as string}</span>;
        if (ci === 8) {
          const s = cell as Strategy;
          const isArchived = s.status === "ARCHIVED";
          // Show the busy indicator for whichever in-flight path applies to
          // this row: restore (per-row id) or archive (modal target id +
          // global archiveBusy). Previously only restore got feedback, so the
          // user could click Archive again before the modal closed and have
          // the row appear stuck/unresponsive.
          const busy = isArchived
            ? restoreBusyId === s.id
            : archiveBusy && archiveBusyId === s.id;
          return (
            <Btn
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (isArchived) onRestore(s);
                else onArchive(s);
              }}
            >
              {busy ? "…" : isArchived ? "Restore" : "Archive"}
            </Btn>
          );
        }
        return cell as ReactNode;
      }}
    />
  );
}

function ArchiveConfirmModal({
  strategy,
  busy,
  skipConfirm,
  onSkipConfirmChange,
  onCancel,
  onConfirm,
}: {
  strategy: Strategy;
  busy: boolean;
  skipConfirm: boolean;
  onSkipConfirmChange: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const T = useT();
  const liveBots = strategy.botsCount > 0;
  const titleId = "archive-confirm-title";
  const cancelWrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Land focus on Cancel so keyboard users start inside the dialog at the
    // non-destructive action. Escape also cancels (matches the backdrop click).
    cancelWrapRef.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.surface,
          border: `1px solid ${T.outline}`,
          borderRadius: 8,
          maxWidth: 460,
          width: "100%",
          padding: 24,
          fontFamily: T.fontSans,
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontFamily: T.fontHead,
            fontSize: 18,
            fontWeight: 600,
            color: T.text,
          }}
        >
          Archive this strategy?
        </h2>
        <p style={{ marginTop: 12, color: T.text2, fontSize: 13, lineHeight: 1.5 }}>
          <span style={{ color: T.text }}>&ldquo;{strategy.name}&rdquo;</span> will
          move to the Archived bucket. Backtests are preserved and you can restore
          it any time. The strategy stops appearing in scans and bot picker lists.
        </p>
        {liveBots && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              border: `1px solid ${T.warning}`,
              borderRadius: 6,
              background: `${T.warning}11`,
              color: T.warning,
              fontSize: 12.5,
              lineHeight: 1.45,
            }}
          >
            {strategy.botsCount} live{" "}
            {strategy.botsCount === 1 ? "bot is" : "bots are"} bound to this
            strategy. Once archived, the trading engine will skip them on the next
            cycle — they&rsquo;ll stop trading until you restore the strategy or
            rebind them.
          </div>
        )}
        <div
          style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {liveBots ? (
            <span style={{ fontSize: 11, color: T.text3 }}>
              Bot warning shown because live bots are bound.
            </span>
          ) : (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: T.text2,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={skipConfirm}
                onChange={(e) => onSkipConfirmChange(e.target.checked)}
                disabled={busy}
                style={{ accentColor: T.primary, cursor: busy ? "not-allowed" : "pointer" }}
              />
              Don&rsquo;t show this again
            </label>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <span ref={cancelWrapRef} style={{ display: "inline-flex" }}>
              <Btn variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Btn>
            </span>
            <Btn variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
              {busy ? "Archiving…" : "Archive"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  const presets: { title: string; desc: string; badge: string | null }[] = [
    { title: "Mean reversion", desc: "RSI-based oversold bounce", badge: "popular" },
    { title: "Momentum breakout", desc: "Price breaks SMA with volume", badge: null },
    { title: "Golden cross", desc: "SMA(50) crosses above SMA(200)", badge: null },
    { title: "Bollinger squeeze", desc: "Volatility contraction breakout", badge: "new" },
    { title: "MACD cross", desc: "Classic 12/26/9 trend follow", badge: null },
    { title: "Blank canvas", desc: "Start from scratch", badge: null },
  ];
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
            tablet: "1.4fr 1fr",
            desktop: "1.4fr 1fr",
          }),
          gap: pick(bp, { mobile: 32, tablet: 36, desktop: 48 }),
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div>
          <Kicker>start here</Kicker>
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
            Build your first{" "}
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>
              strategy
            </span>
            .
          </h2>
          <p style={{ fontSize: 14, color: T.text2, lineHeight: 1.7, maxWidth: 520 }}>
            A strategy is a tree of conditions — RSI oversold, SMA crossovers, volume surges — that
            fires a signal when they all agree. From there you can backtest it, deploy it to signals
            you trade manually, or bind a paper-trading bot.
          </p>
          <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/strategies/new" style={{ textDecoration: "none" }}>
              <Btn variant="primary" size="lg" icon={Icon.plus}>
                New strategy
              </Btn>
            </Link>
            <Btn variant="ghost" size="lg" onClick={onImport}>
              Import JSON
            </Btn>
          </div>

          <div style={{ marginTop: 40 }}>
            <Ribbon kicker="the three outputs" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                gap: 14,
                marginTop: 8,
              }}
            >
              {(
                [
                  ["⎈", T.primary, "Backtest", "Run it on history"],
                  ["◉", T.deploy, "Signals", "Fire to your feed"],
                  ["◇", T.accent, "Bot", "Paper-trade live"],
                ] as const
              ).map(([g, c, t, d]) => (
                <div
                  key={t}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0" }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: c + "22",
                      color: c,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: T.fontHead,
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {g}
                  </span>
                  <div>
                    <div style={{ fontFamily: T.fontHead, fontSize: 13, fontWeight: 500 }}>{t}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <Kicker>start from a preset</Kicker>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 1 }}>
            {presets.map((p, i) => (
              <div
                key={p.title}
                style={{
                  padding: "14px 16px",
                  background: i === 0 ? T.surfaceLow : "transparent",
                  borderTop: `1px solid ${T.outlineFaint}`,
                  borderBottom:
                    i === presets.length - 1 ? `1px solid ${T.outlineFaint}` : undefined,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontFamily: T.fontHead,
                        fontSize: 14,
                        fontWeight: 500,
                        color: T.text,
                      }}
                    >
                      {p.title}
                    </span>
                    {p.badge && (
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 9.5,
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: T.primaryLight + "22",
                          color: T.primaryLight,
                        }}
                      >
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.text3, marginTop: 3 }}>{p.desc}</div>
                </div>
                {/* No CTA — preset routing isn't wired yet. Cards read as
                    informational pattern examples; "New strategy" above
                    opens the blank editor for any of these. */}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
