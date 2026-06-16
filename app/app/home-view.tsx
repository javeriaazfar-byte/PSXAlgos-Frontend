"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { AppFrame } from "@/components/frame";
import { useT } from "@/components/theme";
import { EditorialHeader, Kicker, Btn } from "@/components/atoms";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";
import { useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DashStrategy {
  id: string;
  name: string;
  status: "DEPLOYED" | "DRAFT" | "PAUSED" | "ARCHIVED";
  bt: string;
  sharpe: number | null;
  signals: number;
  botsCount: number;
}

export interface DashSignal {
  id: string;
  strategy: string;
  symbol: string;
  price: number;
  dir: "BUY" | "SELL";
  age: string;
}

export interface DashBot {
  id: string;
  name: string;
  strategy: string;
  strategyId: string | null;
  pnl: number;
  status: "RUNNING" | "PAUSED" | "STOPPED";
  openPositions: number;
  // Equity-curve points (total_equity over the last 30 days) for the sparkline.
  spark: number[];
}

export interface DashPosition {
  id: string;
  sym: string;
  qty: number;
  entry: number;
  now: number | null;
  strat: string | null;
  date: string;
}

export interface DashboardViewProps {
  totalStrategies: number;
  deployedStrategies: number;
  draftStrategies: number;
  signalsToday: number;
  strategiesToday: number;
  bestBt: string;
  bestSharpe: number | null;
  bestBtName: string;
  runningBots: number;
  pausedBots: number;
  totalBots: number;
  openPositionCount: number;
  closedTradeCount: number;
  realizedPnl: number;
  strategies: DashStrategy[];
  signals: DashSignal[];
  bots: DashBot[];
  positions: DashPosition[];
  portfolioSeries: number[];
  buyToday: number;
  sellToday: number;
  userName: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPkr(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}PKR ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}PKR ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}PKR ${Math.round(abs).toLocaleString()}`;
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

export function DashboardView({
  signalsToday,
  runningBots,
  pausedBots,
  totalBots,
  openPositionCount,
  realizedPnl,
  signals,
  bots,
  positions,
  portfolioSeries,
  buyToday,
  sellToday,
  userName,
}: DashboardViewProps) {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  const router = useRouter();

  // Accent line (3px top border) colours per card. Amber (dark) mode keeps the
  // earthy gold/orange/green it already had; Paper (light) mode uses an explicit
  // yellow / yellow / green set.
  const lines =
    T.mode === "dark"
      ? { bots: T.accent, portfolio: T.primary, signals: T.deploy }
      : { bots: "#d4a017", portfolio: "#d4a017", signals: "#2e8a5f" };

  const firstName = userName ? userName.split(" ")[0] : null;

  // Portfolio snapshot derived from open positions
  const totalInvested = positions.reduce((s, p) => s + p.qty * p.entry, 0);
  const totalValue = positions.reduce(
    (s, p) => s + p.qty * (p.now ?? p.entry),
    0
  );
  const unrealizedPkr = totalValue - totalInvested;
  const unrealizedPct =
    totalInvested > 0 ? (unrealizedPkr / totalInvested) * 100 : 0;

  // Signals sentiment score in [-1, 1] → gauge needle
  const sigTotal = buyToday + sellToday;
  const sentiment = sigTotal > 0 ? (buyToday - sellToday) / sigTotal : null;

  return (
    <AppFrame route="/">
      <EditorialHeader
        kicker="Dashboard · overview"
        title={
          <>
            Welcome back{firstName ? `, ${firstName}` : ""}
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}> ·</span>{" "}
            <span style={{ color: T.text3, fontWeight: 400, fontSize: "0.7em" }}>
              here&apos;s what&apos;s happening.
            </span>
          </>
        }
        meta={
          <>
            <span>
              <span style={{ color: runningBots > 0 ? T.gain : T.text3 }}>●</span>{" "}
              {runningBots} running
            </span>
            <span>{openPositionCount} open position{openPositionCount !== 1 ? "s" : ""}</span>
            <span style={{ color: signalsToday > 0 ? T.deploy : T.text3 }}>
              {signalsToday} signal{signalsToday !== 1 ? "s" : ""} today
            </span>
          </>
        }
      />

      {/* ── 3-card grid ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: pick(bp, {
            mobile: `16px ${padX} 24px`,
            desktop: `20px ${padX} 24px`,
          }),
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
          gap: 14,
          overflow: isMobile ? "auto" : "hidden",
        }}
      >
        {/* ── BOTS card ── */}
        <DashCard
          kicker="bots"
          accentColor={lines.bots}
          footer={
            <CardFooter
              left={
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  {runningBots > 0 && (
                    <span style={{ color: T.gain }}>{runningBots} running</span>
                  )}
                  {runningBots > 0 && pausedBots > 0 && " · "}
                  {pausedBots > 0 && (
                    <span style={{ color: T.warning }}>{pausedBots} paused</span>
                  )}
                  {totalBots === 0 && <span>no bots yet</span>}
                </span>
              }
              right={
                <Btn variant="ghost" size="sm" onClick={() => router.push("/bots")}>
                  Manage bots →
                </Btn>
              }
            />
          }
        >
          {bots.length === 0 ? (
            <EmptyNote>No active bots yet. Deploy a strategy to start one.</EmptyNote>
          ) : (
            bots.map((b) => <BotRow key={b.id} bot={b} />)
          )}
        </DashCard>

        {/* ── PORTFOLIO card ── */}
        <DashCard
          kicker="portfolio"
          accentColor={lines.portfolio}
          footer={
            <CardFooter
              left={
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  {openPositionCount} open position{openPositionCount !== 1 ? "s" : ""}
                </span>
              }
              right={
                <Btn variant="ghost" size="sm" onClick={() => router.push("/portfolio")}>
                  Portfolio →
                </Btn>
              }
            />
          }
        >
          {/* Hero value */}
          <div style={{ padding: "14px 0 6px" }}>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 9.5,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: T.text3,
              }}
            >
              Portfolio value
            </div>
            <div
              style={{
                fontFamily: T.fontHead,
                fontSize: clampPx(24, 4.4, 32),
                fontWeight: 500,
                color: T.text,
                letterSpacing: -0.5,
                lineHeight: 1.05,
                marginTop: 3,
              }}
            >
              {fmtPkr(totalValue)}
            </div>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 11.5,
                color: unrealizedPkr >= 0 ? T.gain : T.loss,
                marginTop: 5,
              }}
            >
              {unrealizedPkr >= 0 ? "▲ +" : "▼ "}
              {fmtPkr(unrealizedPkr)} ({unrealizedPct >= 0 ? "+" : ""}
              {unrealizedPct.toFixed(2)}%) open
            </div>
          </div>

          {/* Main graph: cumulative realized P&L */}
          <div style={{ marginTop: 4 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontFamily: T.fontMono,
                fontSize: 9.5,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: T.text3,
                marginBottom: 4,
              }}
            >
              <span>Realized P&amp;L · cumulative</span>
              {portfolioSeries.length > 0 && (
                <span
                  style={{
                    color: realizedPnl >= 0 ? T.gain : T.loss,
                    fontWeight: 600,
                  }}
                >
                  {realizedPnl >= 0 ? "+" : ""}
                  {fmtPkr(realizedPnl)}
                </span>
              )}
            </div>
            <PortfolioChart data={portfolioSeries} />
          </div>

          {/* Snapshot highlights */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px 10px",
              padding: "14px 0 6px",
              marginTop: 6,
              borderTop: `1px solid ${T.outlineFaint}`,
            }}
          >
            <Stat label="Invested" value={fmtPkr(totalInvested)} />
            <Stat
              label="Unrealized"
              value={`${unrealizedPkr >= 0 ? "+" : ""}${fmtPkr(unrealizedPkr)}`}
              color={unrealizedPkr >= 0 ? T.gain : T.loss}
            />
            <Stat
              label="Realized"
              value={`${realizedPnl >= 0 ? "+" : ""}${fmtPkr(realizedPnl)}`}
              color={realizedPnl >= 0 ? T.gain : T.loss}
            />
            <Stat label="Open positions" value={String(openPositionCount)} />
          </div>
        </DashCard>

        {/* ── SIGNALS card ── */}
        <DashCard
          kicker="signals"
          accentColor={lines.signals}
          footer={
            <CardFooter
              left={
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3 }}>
                  {sigTotal > 0 ? (
                    <>
                      <span style={{ color: T.gain }}>{buyToday} BUY</span>
                      {" · "}
                      <span style={{ color: T.loss }}>{sellToday} SELL</span>
                    </>
                  ) : (
                    "no signals today"
                  )}
                </span>
              }
              right={
                <Btn variant="ghost" size="sm" onClick={() => router.push("/signals")}>
                  All signals →
                </Btn>
              }
            />
          }
        >
          {/* Gauge meter */}
          <div style={{ padding: "12px 0 4px" }}>
            <Gauge sentiment={sentiment} buy={buyToday} sell={sellToday} />
          </div>

          {/* Latest signals (compact, no bars) */}
          {signals.length > 0 && (
            <div style={{ borderTop: `1px solid ${T.outlineFaint}`, marginTop: 4 }}>
              {signals.slice(0, 5).map((sig) => (
                <SignalRow key={sig.id} sig={sig} />
              ))}
            </div>
          )}
          {signals.length === 0 && (
            <EmptyNote>No signals have fired today.</EmptyNote>
          )}
        </DashCard>
      </div>
    </AppFrame>
  );
}

// ── Card shell ─────────────────────────────────────────────────────────────────

function DashCard({
  kicker,
  accentColor,
  footer,
  children,
}: {
  kicker: string;
  accentColor: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  const T = useT();
  return (
    <div
      style={{
        background: T.surfaceLowest,
        border: `1px solid ${T.outlineVariant}`,
        borderRadius: 10,
        borderTop: `3px solid ${accentColor}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${T.outlineFaint}`,
          flexShrink: 0,
        }}
      >
        <Kicker color={accentColor}>{kicker}</Kicker>
      </div>

      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 16px",
          minHeight: 0,
        }}
      >
        {children}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: `1px solid ${T.outlineFaint}`,
          flexShrink: 0,
        }}
      >
        {footer}
      </div>
    </div>
  );
}

function CardFooter({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px 8px 16px",
        gap: 8,
      }}
    >
      {left}
      {right}
    </div>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────────

function EmptyNote({ children }: { children: ReactNode }) {
  const T = useT();
  return (
    <div
      style={{
        padding: "20px 0",
        fontFamily: T.fontMono,
        fontSize: 11.5,
        color: T.text3,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const T = useT();
  return (
    <div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: T.text3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: T.fontHead,
          fontSize: 15,
          fontWeight: 600,
          color: color ?? T.text,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Sparkline (bots) ─────────────────────────────────────────────────────────

function Sparkline({
  data,
  color,
  height = 30,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  const T = useT();
  if (!data || data.length < 2) {
    // Not enough history yet — show a flat baseline rather than a fake curve.
    return (
      <div style={{ height, display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: "100%",
            borderTop: `1px dashed ${T.outlineVariant}`,
          }}
        />
      </div>
    );
  }
  const W = 140;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = W / (data.length - 1);
  const pts = data.map(
    (v, i) => [i * stepX, height - ((v - min) / range) * height] as const
  );
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${W},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block", overflow: "visible" }}
    >
      <path d={area} fill={color} fillOpacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Portfolio chart ──────────────────────────────────────────────────────────

function PortfolioChart({ data, height = 96 }: { data: number[]; height?: number }) {
  const T = useT();
  if (!data || data.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px dashed ${T.outlineVariant}`,
          borderRadius: 6,
          fontFamily: T.fontMono,
          fontSize: 10.5,
          color: T.text3,
          textAlign: "center",
          padding: "0 14px",
          lineHeight: 1.5,
        }}
      >
        Your realized P&amp;L curve appears here as you close trades.
      </div>
    );
  }
  const W = 300;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0);
  const range = max - min || 1;
  const stepX = W / (data.length - 1);
  const yFor = (v: number) => height - ((v - min) / range) * height;
  const baseY = yFor(0);
  const pts = data.map((v, i) => [i * stepX, yFor(v)] as const);
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${W},${baseY.toFixed(1)} L0,${baseY.toFixed(1)} Z`;
  const up = data[data.length - 1] >= 0;
  const color = up ? T.gain : T.loss;
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
    >
      <defs>
        <linearGradient id="psx-portfolio-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {/* zero baseline */}
      <line
        x1="0"
        y1={baseY}
        x2={W}
        y2={baseY}
        stroke={T.outlineVariant}
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      <path d={area} fill="url(#psx-portfolio-grad)" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Gauge (signals) ──────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// Annular sector from startDeg (larger) → endDeg (smaller), measured with
// 0° = right, 180° = left, arc over the top of the circle.
function arcBand(
  cx: number,
  cy: number,
  rO: number,
  rI: number,
  startDeg: number,
  endDeg: number
) {
  const oS = polar(cx, cy, rO, startDeg);
  const oE = polar(cx, cy, rO, endDeg);
  const iE = polar(cx, cy, rI, endDeg);
  const iS = polar(cx, cy, rI, startDeg);
  return [
    `M${oS.x.toFixed(2)},${oS.y.toFixed(2)}`,
    `A${rO},${rO} 0 0 1 ${oE.x.toFixed(2)},${oE.y.toFixed(2)}`,
    `L${iE.x.toFixed(2)},${iE.y.toFixed(2)}`,
    `A${rI},${rI} 0 0 0 ${iS.x.toFixed(2)},${iS.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function Gauge({
  sentiment,
  buy,
  sell,
}: {
  sentiment: number | null;
  buy: number;
  sell: number;
}) {
  const T = useT();
  const cx = 120;
  const cy = 118;
  const rO = 104;
  const rI = 74;

  // 5 zones across 180°, left (180°) → right (0°), 36° each.
  const zones = [
    { from: 180, to: 144, color: T.loss },              // Strong Sell
    { from: 144, to: 108, color: T.loss + "59" },       // Sell
    { from: 108, to: 72, color: T.outlineVariant },     // Neutral
    { from: 72, to: 36, color: T.gain + "59" },         // Buy
    { from: 36, to: 0, color: T.gain },                 // Strong Buy
  ];

  const hasData = sentiment != null;
  // needleAngle: sentiment -1 → 180° (left), +1 → 0° (right), 0 → 90° (up)
  const needleAngle = hasData ? 90 - sentiment * 90 : 90;
  const needle = polar(cx, cy, rI - 8, needleAngle);

  // Verdict text
  let verdict = "Neutral";
  let verdictColor = T.text3;
  if (hasData) {
    if (sentiment <= -0.6) { verdict = "Strong Sell"; verdictColor = T.loss; }
    else if (sentiment <= -0.2) { verdict = "Sell"; verdictColor = T.loss; }
    else if (sentiment < 0.2) { verdict = "Neutral"; verdictColor = T.text2; }
    else if (sentiment < 0.6) { verdict = "Buy"; verdictColor = T.gain; }
    else { verdict = "Strong Buy"; verdictColor = T.gain; }
  } else {
    verdict = "No signals";
  }

  const labelStyle = { fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 600 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg
        viewBox="0 0 240 150"
        style={{ width: "100%", maxWidth: 240, height: "auto", display: "block" }}
      >
        {zones.map((z, i) => (
          <path key={i} d={arcBand(cx, cy, rO, rI, z.from, z.to)} fill={z.color} />
        ))}

        {/* zone labels */}
        <text x={120} y={14} textAnchor="middle" fill={T.text3} {...labelStyle}>
          Neutral
        </text>
        <text x={40} y={52} textAnchor="middle" fill={T.loss} {...labelStyle}>
          Sell
        </text>
        <text x={200} y={52} textAnchor="middle" fill={T.gain} {...labelStyle}>
          Buy
        </text>
        <text x={8} y={138} textAnchor="start" fill={T.loss} fontFamily={T.fontMono} fontSize={8}>
          Strong Sell
        </text>
        <text x={232} y={138} textAnchor="end" fill={T.gain} fontFamily={T.fontMono} fontSize={8}>
          Strong Buy
        </text>

        {/* needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needle.x}
          y2={needle.y}
          stroke={hasData ? verdictColor : T.outline}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5.5} fill={hasData ? verdictColor : T.outline} />
        <circle cx={cx} cy={cy} r={2} fill={T.surface3} />
      </svg>

      {/* verdict */}
      <div style={{ textAlign: "center", marginTop: -6 }}>
        <div
          style={{
            fontFamily: T.fontHead,
            fontSize: 18,
            fontWeight: 600,
            color: verdictColor,
            letterSpacing: -0.2,
          }}
        >
          {verdict}
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            color: T.text3,
            marginTop: 2,
          }}
        >
          {hasData ? (
            <>
              <span style={{ color: T.gain }}>{buy} buy</span>
              {" · "}
              <span style={{ color: T.loss }}>{sell} sell</span>
              {" today"}
            </>
          ) : (
            "Deploy a strategy to receive signals"
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bot rows ───────────────────────────────────────────────────────────────────

function BotRow({ bot }: { bot: DashBot }) {
  const T = useT();
  const statusColor =
    bot.status === "RUNNING" ? T.gain : bot.status === "PAUSED" ? T.warning : T.text3;
  const pnlColor = bot.pnl >= 0 ? T.gain : T.loss;
  const sparkColor = bot.pnl >= 0 ? T.gain : T.loss;

  const inner = (
    <div style={{ padding: "11px 0 12px", borderBottom: `1px dotted ${T.outlineFaint}` }}>
      {/* Name + status + return */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            background: statusColor,
            boxShadow: bot.status === "RUNNING" ? `0 0 0 3px ${statusColor}28` : "none",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: T.fontSans,
            fontSize: 13,
            color: T.text,
            fontWeight: 500,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {bot.name}
        </span>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 12,
            color: pnlColor,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {bot.pnl >= 0 ? "+" : ""}
          {bot.pnl.toFixed(1)}%
        </span>
      </div>
      {/* Per-bot graph */}
      <Sparkline data={bot.spark} color={sparkColor} />
    </div>
  );

  return bot.id ? (
    <Link href={`/bots/${bot.id}`} style={{ textDecoration: "none" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ── Signal rows ────────────────────────────────────────────────────────────────

function SignalRow({ sig }: { sig: DashSignal }) {
  const T = useT();
  const isBuy = sig.dir === "BUY";
  const dirColor = isBuy ? T.gain : T.loss;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 0",
        borderBottom: `1px dotted ${T.outlineFaint}`,
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: dirColor,
          background: dirColor + "1a",
          padding: "2px 7px",
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        {sig.dir}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 13,
          color: T.text,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {sig.symbol}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 11,
          color: T.text2,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {sig.price > 0 ? sig.price.toFixed(2) : ""}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 10.5,
          color: T.text3,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sig.strategy}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.text3, flexShrink: 0 }}>
        {sig.age}
      </span>
    </div>
  );
}
