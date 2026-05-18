import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signBackendJwt } from "@/lib/api/jwt";
import {
  getStrategies,
  type StrategyResponse,
} from "@/lib/api/strategies";
import { StrategiesView, type Strategy, type Status, type OutputKind } from "./strategies-view";

const MIN_MS = 60_000;

function formatRelative(iso: string | null | undefined): { updated: string; updatedMin: number } {
  if (!iso) return { updated: "—", updatedMin: Number.MAX_SAFE_INTEGER };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { updated: "—", updatedMin: Number.MAX_SAFE_INTEGER };
  const min = Math.max(0, Math.round((Date.now() - t) / MIN_MS));
  if (min < 1) return { updated: "just now", updatedMin: 0 };
  if (min < 60) return { updated: `${min}m ago`, updatedMin: min };
  const h = Math.floor(min / 60);
  if (h < 24) return { updated: `${h}h ago`, updatedMin: min };
  const d = Math.floor(h / 24);
  if (d < 30) return { updated: `${d}d ago`, updatedMin: min };
  const mo = Math.floor(d / 30);
  return { updated: `${mo}mo ago`, updatedMin: min };
}

function mapStatus(s: StrategyResponse["status"]): Status {
  // Backend ACTIVE maps to UI's DEPLOYED — the user-facing word for "currently
  // running and producing signals". DRAFT/PAUSED/ARCHIVED pass through.
  if (s === "ACTIVE") return "DEPLOYED";
  return s;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapStrategy(s: StrategyResponse): Strategy {
  // `latest_backtest`, `signals_today`, `bots_count`, and `last_scan_at`
  // are all populated by the list endpoint via single-query LEFT JOINs
  // (no N+1). Defaults: latest_backtest=null → "—" for the bt cell;
  // signals_today=0 / bots_count=0 → empty outputs / no badges; null
  // last_scan_at → never-scanned sentinel.
  const lb = s.latest_backtest ?? null;
  const totalReturn = toNum(lb?.total_return_pct);
  const sharpeNum = toNum(lb?.sharpe_ratio);
  const bt =
    totalReturn === null
      ? "—"
      : `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`;
  const { updated, updatedMin } = formatRelative(s.updated_at);
  const { updatedMin: lastScanMin } = formatRelative(s.last_scan_at);
  const signalsToday = s.signals_today ?? 0;
  const botsCount = s.bots_count ?? 0;
  // Outputs reflect what the strategy is *actually* producing right now:
  //   "bt"  — has at least one backtest result
  //   "sig" — produced ≥1 signal today (PKT)
  //   "bot" — at least one non-STOPPED bot is running it
  const outputs: OutputKind[] = [];
  if (lb) outputs.push("bt");
  if (signalsToday > 0) outputs.push("sig");
  if (botsCount > 0) outputs.push("bot");
  return {
    id: String(s.id),
    name: s.name,
    type: "Custom",
    status: mapStatus(s.status),
    signals: signalsToday,
    botsCount,
    bt,
    sharpe: sharpeNum,
    outputs,
    updated,
    updatedMin,
    lastScanMin,
  };
}

export default async function StrategiesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/?auth=required&from=/strategies");
  }

  const jwt = signBackendJwt({
    sub: session.user.id,
    email: session.user.email,
  });

  // Wrap the journal fetch so a transient Railway 5xx / Neon hiccup degrades
  // to an empty list + flash toast on mount, instead of surfacing Next.js's
  // global error boundary and wiping the page entirely. Pattern mirrors
  // /portfolio + /bots + /signals.
  let fetchFailed = false;
  const res = await getStrategies(jwt, { page: 1, page_size: 100 }).catch(() => {
    fetchFailed = true;
    return { items: [], total: 0, page: 1, page_size: 0, total_pages: 0 };
  });
  const initialStrategies = res.items.map(mapStrategy);

  return <StrategiesView initialStrategies={initialStrategies} fetchFailed={fetchFailed} />;
}
