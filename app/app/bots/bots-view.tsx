"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/frame";
import { useT } from "@/components/theme";
import {
  Btn,
  EditorialHeader,
  FlashToast,
  Kicker,
  Lede,
  Ribbon,
  TerminalTable,
  useFlash,
  type Col,
} from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";

interface Bot {
  id: string;
  name: string;
  strat: string;
  // null when the underlying strategy has been soft-deleted
  stratId: string | null;
  status: "RUNNING" | "PAUSED" | "STOPPED";
  equity: number;
  start: number;
  pnl: number;
  today: number;
  open: number;
  trades: number;
  uptime: string;
}

export function BotsView({
  initialBots,
  fetchFailed = false,
}: {
  initialBots: Bot[];
  fetchFailed?: boolean;
}) {
  const [bots] = useState<Bot[]>(initialBots);
  const { flash, setFlash } = useFlash();
  const router = useRouter();

  useEffect(() => {
    if (fetchFailed) setFlash("Couldn't load your bots — showing empty list");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFailed]);

  const runningCount = bots.filter((b) => b.status === "RUNNING").length;
  const pausedAll = runningCount === 0 && bots.some((b) => b.status === "PAUSED");

  // Pause-all / resume-all fire one POST per bot via Promise.allSettled.
  // Partial failures used to be silently swallowed; we now surface the
  // first concrete error message so the user knows why N of M succeeded.
  async function bulkAction(
    targets: Bot[],
    action: "start" | "pause",
  ): Promise<{ ok: number; firstErr: string | null }> {
    const results = await Promise.allSettled(
      targets.map((b) =>
        fetch(`/api/bots/${b.id}/${action}`, { method: "POST" }).then((r) => {
          if (!r.ok) throw new Error(`${b.name}: ${r.status}`);
          return b.id;
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const firstRejected = results.find((r) => r.status === "rejected");
    const firstErr =
      firstRejected && firstRejected.status === "rejected"
        ? String((firstRejected.reason as Error)?.message ?? firstRejected.reason)
        : null;
    return { ok, firstErr };
  }

  const handlePauseAll = async () => {
    if (pausedAll) {
      const targets = bots.filter((b) => b.status === "PAUSED");
      const { ok, firstErr } = await bulkAction(targets, "start");
      const msg = `Resumed ${ok} of ${targets.length} paused bot${targets.length === 1 ? "" : "s"}`;
      setFlash(ok < targets.length && firstErr ? `${msg} · ${firstErr}` : msg);
      router.refresh();
    } else if (runningCount > 0) {
      const targets = bots.filter((b) => b.status === "RUNNING");
      const { ok, firstErr } = await bulkAction(targets, "pause");
      const msg = `Paused ${ok} of ${targets.length} running bot${targets.length === 1 ? "" : "s"}`;
      setFlash(ok < targets.length && firstErr ? `${msg} · ${firstErr}` : msg);
      router.refresh();
    }
  };

  return (
    <AppFrame route="/bots">
      <Body
        bots={bots}
        runningCount={runningCount}
        pausedAll={pausedAll}
        onPauseAll={handlePauseAll}
      />
      {flash && <FlashToast message={flash} />}
    </AppFrame>
  );
}

function Body({
  bots,
  runningCount,
  pausedAll,
  onPauseAll,
}: {
  bots: Bot[];
  runningCount: number;
  pausedAll: boolean;
  onPauseAll: () => void;
}) {
  const T = useT();
  const empty = bots.length === 0;
  const totalEquity = bots.reduce((s, b) => s + b.equity, 0);
  const todayTotal = bots.reduce((s, b) => s + b.today, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <EditorialHeader
        kicker="Automation · paper-trading runners"
        title={
          <>
            Bots{" "}
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>·</span>{" "}
            {empty ? (
              <span style={{ color: T.text3, fontWeight: 400, fontSize: "0.7em" }}>no bots yet</span>
            ) : (
              `${bots.length} total`
            )}
          </>
        }
        meta={
          empty ? (
            <>
              <span>0 running</span>
              <span>PKR 0 managed</span>
            </>
          ) : (
            <>
              <span>
                <span style={{ color: runningCount > 0 ? T.gain : T.text3 }}>●</span> {runningCount} running
              </span>
              <span>PKR {(totalEquity / 1_000_000).toFixed(2)}M managed</span>
              <span style={{ color: todayTotal >= 0 ? T.gain : T.loss }}>
                {todayTotal >= 0 ? "+" : ""}
                PKR {todayTotal.toLocaleString()} today
              </span>
              <span style={{ color: T.text3 }}>paper-trading · no real broker</span>
            </>
          )
        }
        actions={
          !empty ? (
            <Btn variant="outline" size="sm" onClick={onPauseAll} style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.14)" }}>
              {pausedAll ? "Resume all" : "Pause all"}
            </Btn>
          ) : null
        }
      />

      {empty ? <EmptyState /> : <Populated bots={bots} />}
    </div>
  );
}

function Populated({ bots }: { bots: Bot[] }) {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  // Shrink the big stat numbers on phones so "PKR 9.00M" fits on one line
  // (was wrapping at 40px) and the summary block takes less vertical space —
  // less scrolling. Scales with viewport so it fits even on narrow (320px)
  // phones; tablet/desktop keep the original fixed 40px.
  const ledeSize = pick(bp, { mobile: clampPx(20, 6.5, 30), desktop: "40px" });
  // Lede card values — all derived from the actual bots list. Previously
  // hardcoded with example numbers that survived the scaffold.
  const totalEquity = bots.reduce((s, b) => s + b.equity, 0);
  const totalStart = bots.reduce((s, b) => s + b.start, 0);
  const combinedAbs = totalEquity - totalStart;
  const combinedPct = totalStart > 0 ? (combinedAbs / totalStart) * 100 : 0;
  const todayTotal = bots.reduce((s, b) => s + b.today, 0);
  const openTotal = bots.reduce((s, b) => s + b.open, 0);
  const cols: Col[] = [
    { label: "name", width: "1.4fr", mono: false, primary: true },
    { label: "strategy", width: "1.2fr", mono: false, mobileFullWidth: true },
    { label: "status", width: "100px" },
    { label: "equity", align: "right", width: "140px" },
    { label: "p&l", align: "right", width: "90px" },
    { label: "today", align: "right", width: "110px" },
    { label: "open", align: "right", width: "60px" },
    { label: "trades", align: "right", width: "70px" },
    { label: "uptime", align: "right", width: "80px" },
  ];
  const rows: unknown[][] = bots.map((b) => [
    b,
    b.strat,
    b.status,
    b.equity,
    b.pnl,
    b.today,
    b.open,
    b.trades,
    b.uptime,
  ]);

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: pick(bp, {
          mobile: `18px ${padX} 28px`,
          desktop: `24px ${padX} 40px`,
        }),
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: pick(bp, {
            mobile: "1fr 1fr",
            tablet: "repeat(2, 1fr)",
            desktop: "repeat(4, 1fr)",
          }),
          gap: pick(bp, { mobile: "16px 20px", desktop: "36px" }),
          paddingBottom: 24,
          borderBottom: `1px solid ${T.outlineFaint}`,
        }}
      >
        <Lede
          label="Total equity"
          value={`PKR ${(totalEquity / 1_000_000).toFixed(2)}M`}
          sub={`across ${bots.length} bot${bots.length === 1 ? "" : "s"}`}
          size={ledeSize}
        />
        <Lede
          label="Combined P&L"
          value={`${combinedPct >= 0 ? "+" : ""}${combinedPct.toFixed(2)}%`}
          color={combinedPct >= 0 ? T.gain : T.loss}
          sub={`${combinedAbs >= 0 ? "+" : ""}PKR ${Math.round(combinedAbs).toLocaleString()}`}
          size={ledeSize}
        />
        <Lede
          label="Today"
          value={`${todayTotal >= 0 ? "+" : ""}PKR ${todayTotal.toLocaleString()}`}
          color={todayTotal >= 0 ? T.gain : T.loss}
          sub="unrealized"
          size={ledeSize}
        />
        <Lede
          label="Open positions"
          value={String(openTotal)}
          sub={openTotal === 0 ? "no live trades" : "across all bots"}
          size={ledeSize}
        />
      </div>

      <div style={{ marginTop: 26 }}>
        <Ribbon
          kicker="all bots"
          right={
            <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
              sort: <span style={{ color: T.text2 }}>P&amp;L ↓</span>
            </span>
          }
        />
        <div style={{ marginTop: 8 }}>
          <TerminalTable
            cols={cols}
            rows={rows}
            renderCell={(cell, ci, ri) => {
              if (ci === 0) {
                const b = cell as Bot;
                return (
                  <Link
                    href={`/bots/${b.id}`}
                    style={{
                      fontFamily: T.fontHead,
                      fontSize: 14,
                      color: T.text,
                      fontWeight: 500,
                      letterSpacing: -0.2,
                      textDecoration: "none",
                    }}
                  >
                    {b.name}
                  </Link>
                );
              }
              if (ci === 1) {
                const b = bots[ri];
                const name = cell as ReactNode;
                if (!b || !b.stratId) {
                  // Strategy is gone (soft-deleted on the backend) — show
                  // last-known name + a "(deleted)" badge instead of a link.
                  return (
                    <span style={{ color: T.text3 }}>
                      {name}{" "}
                      <span style={{ color: T.warning, fontSize: 10.5, letterSpacing: 0.4 }}>
                        (deleted)
                      </span>
                    </span>
                  );
                }
                return (
                  <Link
                    href={`/strategies/${b.stratId}`}
                    style={{ color: T.primaryLight, textDecoration: "none" }}
                  >
                    {name}
                  </Link>
                );
              }
              if (ci === 2) {
                const st = cell as Bot["status"];
                const c = { RUNNING: T.gain, PAUSED: T.warning, STOPPED: T.text3 }[st];
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
                        boxShadow: st === "RUNNING" ? `0 0 0 2px ${c}33` : undefined,
                      }}
                    />
                    {st.toLowerCase()}
                  </span>
                );
              }
              if (ci === 3)
                return (
                  <span style={{ color: T.text }}>
                    {((cell as number) / 1000).toFixed(1)}K
                  </span>
                );
              if (ci === 4) {
                const n = Number(cell);
                return (
                  <span style={{ color: n >= 0 ? T.gain : T.loss }}>
                    {n > 0 ? "+" : ""}
                    {n.toFixed(2)}%
                  </span>
                );
              }
              if (ci === 5) {
                const n = Number(cell);
                if (n === 0) return <span style={{ color: T.text3 }}>—</span>;
                return (
                  <span style={{ color: n >= 0 ? T.gain : T.loss }}>
                    {n > 0 ? "+" : ""}
                    {n.toLocaleString()}
                  </span>
                );
              }
              if (ci === 6)
                return (
                  <span style={{ color: Number(cell) > 0 ? T.text : T.text3 }}>
                    {cell as ReactNode}
                  </span>
                );
              if (ci === 7 || ci === 8)
                return <span style={{ color: T.text3 }}>{cell as ReactNode}</span>;
              return cell as ReactNode;
            }}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 32,
          padding: 16,
          background: T.surfaceLow,
          border: `1px dashed ${T.outlineFaint}`,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span style={{ fontFamily: T.fontHead, fontSize: 20, color: T.accent }}>◇</span>
        <div style={{ flex: 1, fontSize: 13, color: T.text2 }}>
          <span style={{ color: T.text, fontWeight: 500 }}>Want another bot?</span> Open a strategy
          and hit <span style={{ color: T.accent }}>Spin up bot</span>. Bots are always bound to a
          strategy — they don&apos;t exist on their own.
        </div>
        <Link href="/strategies" style={{ textDecoration: "none" }}>
          <Btn variant="ghost" size="sm">
            Browse strategies →
          </Btn>
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: pick(bp, { mobile: `28px ${padX}`, desktop: `48px ${padX}` }),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 720, textAlign: "center" }}>
        <div style={{ fontFamily: T.fontHead, fontSize: clampPx(48, 14, 72), color: T.accent, lineHeight: 1 }}>◇</div>
        <Kicker color={T.accent}>automation</Kicker>
        <h2
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(30, 7, 44),
            fontWeight: 500,
            margin: "14px 0 16px",
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
          }}
        >
          No bots{" "}
          <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>yet</span>.
        </h2>
        <p
          style={{
            fontSize: 14,
            color: T.text2,
            lineHeight: 1.7,
            maxWidth: 520,
            margin: "0 auto 22px",
          }}
        >
          A bot is a paper-trading runner bound to one of your strategies. It watches the market,
          fires the strategy&apos;s signals, and simulates a portfolio. No real broker — no real
          money.
        </p>
        <div style={{ display: "inline-flex", gap: 10 }}>
          <Link href="/strategies" style={{ textDecoration: "none" }}>
            <Btn variant="primary" size="lg" icon={Icon.plus}>
              Pick a strategy to bind
            </Btn>
          </Link>
        </div>
        <div
          style={{
            marginTop: 32,
            padding: 20,
            background: T.surfaceLow,
            borderRadius: 8,
            textAlign: "left",
            border: `1px solid ${T.outlineFaint}`,
          }}
        >
          <Kicker>the flow</Kicker>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: T.fontMono,
              fontSize: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: T.primaryLight }}>Strategies</span>
            <span style={{ color: T.text3 }}>→</span>
            <span style={{ color: T.text2 }}>Pick one</span>
            <span style={{ color: T.text3 }}>→</span>
            <span style={{ color: T.accent }}>Spin up bot</span>
            <span style={{ color: T.text3 }}>→</span>
            <span style={{ color: T.gain }}>Running</span>
          </div>
        </div>
      </div>
    </div>
  );
}
