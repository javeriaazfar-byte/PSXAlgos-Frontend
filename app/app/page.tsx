import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LandingContent from "./landing-content";
import {
  DashboardView,
  type DashStrategy,
  type DashBot,
  type DashPosition,
} from "./home-view";
import { signBackendJwt } from "@/lib/api/jwt";
import { getStrategies } from "@/lib/api/strategies";
import { getBots } from "@/lib/api/bots";
import {
  getOpenPositions,
  getClosedTrades,
} from "@/lib/api/portfolio";
import { getTodaySignals, type StrategySignal } from "@/lib/api/signals";

// WebApplication JSON-LD scoped to the marketing landing — pairs with the
// Organization/WebSite graph in layout.tsx. Lives here (not the layout) so
// it only renders on the public marketing surface, not on every authed
// app page where it would misrepresent the route.
const LANDING_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "PSX Algos",
  url: "https://psxalgos.com",
  applicationCategory: "FinanceApplication",
  applicationSubCategory: "Trading Strategy Backtesting",
  operatingSystem: "Web",
  inLanguage: "en",
  description:
    "Visual trading-strategy builder, backtester, signal feed, and paper-trading bot platform for the Pakistan Stock Exchange (PSX). Compose strategies as a tree of indicator conditions, backtest on a decade of PSX data, and deploy as live signals or simulated bots — no code.",
  featureList: [
    "Visual no-code strategy editor (tree of indicator conditions)",
    "Backtest on a decade of PSX end-of-day historical data",
    "Live signal feeds during PSX market hours",
    "Paper-trading bots with simulated execution",
    "RSI, MACD, moving averages, volume, ATR, Bollinger Bands",
    "Coverage of KSE-100, KSE-30, KSE-All Share, and KMI-30 constituents",
  ],
  offers: { "@type": "Offer", price: "0", priceCurrency: "PKR" },
  audience: {
    "@type": "Audience",
    audienceType: "Retail traders, finance students, and quant-curious developers in Pakistan",
  },
  publisher: { "@id": "https://psxalgos.com/#organization" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function safePct(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function fmtReturn(v: unknown): string {
  const n = safePct(v);
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function ageFromDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  const hrs = Math.floor(mins / 60);
  if (hrs >= 24) return `${Math.floor(hrs / 24)}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

function mapStrategyStatus(status: string): DashStrategy["status"] {
  if (status === "ACTIVE") return "DEPLOYED";
  if (status === "PAUSED") return "PAUSED";
  if (status === "DRAFT") return "DRAFT";
  return "ARCHIVED";
}

function mapBotStatus(status: string): DashBot["status"] {
  if (status === "ACTIVE") return "RUNNING";
  if (status === "PAUSED") return "PAUSED";
  return "STOPPED";
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function Home() {
  const session = await auth();

  // Unauthenticated → marketing landing
  if (!session?.user) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(LANDING_JSONLD) }}
        />
        <LandingContent />
      </>
    );
  }

  const jwt = signBackendJwt({
    sub: session.user.id ?? "",
    email: session.user.email ?? "",
  });

  // Fetch all dashboard data in parallel; degrade gracefully on any failure
  const [strategiesRes, botsRes, positionsRes, closedRes, signalsRes] =
    await Promise.allSettled([
      getStrategies(jwt),
      getBots(jwt),
      getOpenPositions(jwt),
      getClosedTrades(jwt),
      getTodaySignals(jwt),
    ]);

  const strategies =
    strategiesRes.status === "fulfilled" ? (strategiesRes.value?.items ?? []) : [];
  const bots =
    botsRes.status === "fulfilled" ? (botsRes.value?.items ?? []) : [];
  const openPositions =
    positionsRes.status === "fulfilled" ? (positionsRes.value?.positions ?? []) : [];
  const closedTrades =
    closedRes.status === "fulfilled" ? (closedRes.value?.trades ?? []) : [];
  const signalGroups =
    signalsRes.status === "fulfilled"
      ? (signalsRes.value?.groups ?? [])
      : [];

  // ── Aggregate stats ─────────────────────────────────────────────────────────

  const totalStrategies = strategies.length;
  const deployedStrategies = strategies.filter((s) => s.status === "ACTIVE").length;
  const draftStrategies = strategies.filter((s) => s.status === "DRAFT").length;
  const signalsToday = strategies.reduce(
    (sum, s) => sum + (s.signals_today ?? 0),
    0
  );
  const strategiesToday = strategies.filter(
    (s) => (s.signals_today ?? 0) > 0
  ).length;

  // Best backtest by total return
  let bestBt = "—";
  let bestSharpe: number | null = null;
  let bestBtName = "—";
  {
    let bestRet = -Infinity;
    for (const s of strategies) {
      const ret = safePct(s.latest_backtest?.total_return_pct);
      if (ret == null) continue;
      if (ret > bestRet) {
        bestRet = ret;
        bestBt = fmtReturn(ret);
        bestSharpe = safePct(s.latest_backtest?.sharpe_ratio);
        bestBtName = s.name;
      }
    }
  }

  const runningBots = bots.filter((b) => b.status === "ACTIVE").length;
  const pausedBots = bots.filter((b) => b.status === "PAUSED").length;
  const realizedPnl = closedTrades.reduce(
    (sum, t) => sum + (safePct(t.pnl) ?? 0),
    0
  );

  // ── Top strategies (sorted by signals today, then by best backtest) ─────────

  const dashStrategies: DashStrategy[] = strategies
    .filter((s) => s.status !== "ARCHIVED")
    .sort((a, b) => {
      const sigDiff = (b.signals_today ?? 0) - (a.signals_today ?? 0);
      if (sigDiff !== 0) return sigDiff;
      const retA = safePct(a.latest_backtest?.total_return_pct) ?? -Infinity;
      const retB = safePct(b.latest_backtest?.total_return_pct) ?? -Infinity;
      return retB - retA;
    })
    .slice(0, 7)
    .map((s) => ({
      id: String(s.id),
      name: s.name,
      status: mapStrategyStatus(s.status),
      bt: fmtReturn(s.latest_backtest?.total_return_pct),
      sharpe: safePct(s.latest_backtest?.sharpe_ratio),
      signals: s.signals_today ?? 0,
      botsCount: s.bots_count ?? 0,
    }));

  // ── Today's signals (flat, sorted newest first) ─────────────────────────────

  const allSignals = signalGroups.flatMap((g) =>
    g.signals.map((sig: StrategySignal) => ({
      id: String(sig.id),
      strategy: g.strategy_name,
      symbol: sig.symbol,
      price: safePct(sig.trigger_price) ?? 0,
      dir: sig.signal_type === "SELL" ? ("SELL" as const) : ("BUY" as const),
      age: ageFromDate(sig.signal_date),
    }))
  );
  const dashSignals = allSignals.slice(0, 7);

  // ── Active / paused bots ────────────────────────────────────────────────────

  const dashBots: DashBot[] = bots
    .filter((b) => b.status === "ACTIVE" || b.status === "PAUSED")
    .slice(0, 5)
    .map((b) => ({
      id: String(b.id),
      name: b.name,
      strategy: b.strategy_name ?? "—",
      strategyId: b.strategy_deleted ? null : String(b.strategy_id),
      pnl: safePct(b.total_return_pct) ?? 0,
      status: mapBotStatus(b.status),
      openPositions: b.open_positions_count ?? 0,
    }));

  // ── Open positions snapshot ─────────────────────────────────────────────────

  const dashPositions: DashPosition[] = openPositions.slice(0, 5).map((p) => ({
    id: String(p.id),
    sym: p.symbol,
    qty: p.quantity,
    entry: safePct(p.entry_price) ?? 0,
    now: safePct(p.current_price),
    strat: p.strategy_name ?? null,
    date: new Date(p.opened_at).toLocaleDateString("en-GB", {
      month: "short",
      day: "2-digit",
    }),
  }));

  return (
    <DashboardView
      totalStrategies={totalStrategies}
      deployedStrategies={deployedStrategies}
      draftStrategies={draftStrategies}
      signalsToday={signalsToday}
      strategiesToday={strategiesToday}
      bestBt={bestBt}
      bestSharpe={bestSharpe}
      bestBtName={bestBtName}
      runningBots={runningBots}
      pausedBots={pausedBots}
      totalBots={bots.length}
      openPositionCount={openPositions.length}
      closedTradeCount={closedTrades.length}
      realizedPnl={realizedPnl}
      strategies={dashStrategies}
      signals={dashSignals}
      bots={dashBots}
      positions={dashPositions}
      userName={session.user.name ?? null}
    />
  );
}
