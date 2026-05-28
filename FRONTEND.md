# PSX UI — Frontend

> FastAPI backend → Next.js 15 frontend. Active repo; `psx-trading-view/` is legacy.
> Last updated: 2026-05-28 (new `/contact` page + `/api/contact` form route via Resend; Feedback button added across MarketingNav / TopNav / MobileDrawer)

---

## Directory Structure

```
app/
├── app/                   # Next.js App Router pages + API proxy routes
│   ├── api/               # Proxy routes (forward auth headers to Railway backend)
│   │   ├── contact/route.ts                       # POST → Resend (sends form to support@)
│   │   └── strategies/
│   │       ├── [id]/
│   │       │   └── backtests/
│   │       │       └── [backtestId]/
│   │       │           └── chart-series/route.ts   # BT5 proxy
│   │       └── route.ts
│   ├── backtest/          # /backtests/[id] — result page, chart, trade log
│   ├── bots/              # /bots — bot management
│   ├── contact/           # /contact — feedback form + direct channels
│   ├── leaderboard/
│   ├── portfolio/
│   ├── pricing/
│   ├── signals/
│   └── strategies/        # /strategies — list + editor
├── components/            # Shared UI primitives
│   ├── atoms.tsx          # TerminalTable, StatTile, Badge, ProgressBar, etc.
│   ├── charts.tsx         # Shared Recharts wrappers (not used for backtest price chart)
│   ├── strategy-editor/   # Strategy rule tree + expression editor
│   └── ...
└── lib/
    ├── api/               # Typed API client functions (strategies.ts, bots.ts, …)
    ├── hooks/             # SWR data hooks
    └── strategy/          # Expression parser + AST types (SB1/SB2)
```

---

## Conventions

- **SWR for all server state.** Every hook exposes `hasLoaded`, `isValidating`, `error`.
- `errorRetryCount: 0` on all SWR hooks — retries are handled by `client.ts` (3 attempts, exponential backoff).
- `keepPreviousData: true` to prevent layout shifts.
- `revalidateOnFocus: false` on data that doesn't change between user actions.
- No `any` types. Proper interfaces for all API responses, exported alongside hooks for BE↔FE schema parity verification.
- `showToast.error()` for user-facing failures. Never show raw error messages.

---

## Hooks Reference

### `useBacktestChartSeries(strategyId, backtestId)` — `app/lib/hooks/useBacktestChartSeries.ts`

Fetches per-symbol OHLC + trade overlay data for the backtest price chart.

```ts
interface BacktestOHLCBar { t: number; o: number; h: number; l: number; c: number; v: number; }
interface BacktestChartSeries { symbol: string; bars: BacktestOHLCBar[]; }
interface BacktestChartSeriesResponse { series: BacktestChartSeries[]; }

useBacktestChartSeries(strategyId: number | null, backtestId: number | null)
// Returns: { chartData, hasLoaded, isValidating, error }
```

- Key: `/api/strategies/${strategyId}/backtests/${backtestId}/chart-series` (null when either ID is null)
- `errorRetryCount: 0`, `keepPreviousData: true`, `revalidateOnFocus: false`
- `chartData` is `BacktestChartSeriesResponse | null`
- Exports the three interfaces for BE↔FE schema parity — import from this file, not redefined elsewhere

### `watchBacktestJob(strategyId, jobId)` — `app/lib/api/backtest-watcher.ts`

One-shot promise that resolves when a background backtest reaches a terminal state. Used by `app/backtest/new/backtest-new-view.tsx` after `POST /api/strategies/{id}/backtest?async_mode=true`.

```ts
watchBacktestJob(stratId: number, jobId: string): Promise<BacktestJobStatus>
```

Hybrid path:
- **WebSocket (primary):** fetches `/api/auth/ws-token`, opens `ws(s)://…/ws?token=…`, listens for `{type:"job_update", job_kind:"backtest", job_id, status}`. Resolves on `completed` or `failed`.
- **Slow poll (safety net):** parallel `GET /api/strategies/{id}/backtest/job/{jobId}` every 5s, 60 attempts (5-min budget), 4-strikes tolerance for transient 5xx / network errors. 4xx aborts immediately.
- Whichever resolves first wins; the loser is aborted via shared `AbortController`. WS is always closed in `finally`.

This replaces the old in-component `pollJob()` (1.5s × 30 attempts = 45s budget) which couldn't survive 10yr × all-stocks backtests.

---

## Component Architecture

### `BacktestPriceChart` — `app/app/backtest/backtest-price-chart.tsx`

Candlestick price chart with trade entry/exit markers, connector lines, crosshair tooltip, and zoom-to-trade support.

**Props:**
```ts
interface BacktestPriceChartProps {
  symbol: string;
  bars: BacktestOHLCBar[];
  trades: BacktestTrade[];
  focusedTradeIndex: number | null;
  onClearFocus: () => void;
  chartRef?: RefObject<IChartApi | null>;
}
```

**Key behaviors:**
- Uses `lightweight-charts@5.2.0` via `lightweight-charts-react-wrapper@2.1.1` (TradingView OSS, MIT)
- Must be mounted via `dynamic(() => import('./backtest-price-chart'), { ssr: false })` — imports `lightweight-charts` which has no SSR support
- `CandlestickSeries` with `SeriesMarker` array: `▲ entry` (below bar, `T.gain`) + `▼ exit` (above bar, `T.gain`/`T.loss` by PnL)
- One `LineSeries` connector per trade, colored `T.gain` (PnL ≥ 0) or `T.loss`
- Crosshair tooltip: OHLC values + trade annotation (entry/exit label + PnL + exit reason) on entry/exit dates
- `focusedTradeIndex` effect: calls `chart.timeScale().setVisibleRange({ from: entry−5d, to: exit+5d })`
- "clear focus" button appears when `focusedTradeIndex !== null`
- Empty state: dashed border box when `bars.length === 0`
- Height: 240px mobile / 320px desktop (via `useBreakpoint`)

### `TerminalTable` — `app/components/atoms.tsx`

Generic table primitive used throughout the app.

**`getRowBackground` prop (added BT8, 2026-05-16):**
```ts
getRowBackground?: (rowIndex: number) => string | undefined
```
Allows callers to supply a per-row background color. Used by `backtest-view.tsx` to highlight the focused trade row.

---

## Pages Reference

### `/contact` — `app/app/contact/page.tsx`

Public feedback page. Renders in-page form + a fallback list of direct channels. No auth required.

**Form** (top of page): `name`, `email`, `subject` (optional), `message`. Submits to `POST /api/contact` (see BFF Routes Reference). Inline `Status` state machine (`idle` / `sending` / `success` / `error`) renders the result next to the submit button. On success the form clears; on error the form preserves the user's input and shows a recovery hint pointing at `support@psxalgos.com` directly.

**Honeypot**: hidden `website` input inside an `aria-hidden`, off-screen wrapper (`position: absolute; left: -10000px`) with `tabIndex={-1}`. Bots fill every input they see; humans never reach it. The API silently drops any request where `website` is non-empty (returns 200 so bots don't escalate).

**Direct channels** (below the form, labelled "── or reach me directly"):
- `support@psxalgos.com` — product help / bugs / feedback. Primary mailto.
- `info@psxalgos.com` — general / partnerships / press. Secondary mailto.
- `https://wa.me/923342153065` — WhatsApp link (not `tel:`). PK convention; opens in new tab.

Phone number is deliberately gated behind `/contact` (one click) rather than exposed on the landing footer to keep scrapers off it.

### `/backtests/[id]` — `app/app/backtest/backtest-view.tsx`

Backtest result detail page. Shows verdict, performance charts, trade economics, and trade log.

**Page structure (revamped 2026-05-18, A5 + B2 + C1):**

1. **Verdict** — `VerdictCard` renders an editorial one-line read driven by `computeVerdict(result)`. Tone (`positive` / `neutral` / `mixed` / `negative` / `insufficient`) maps to a colored left rail. A quiet 5-stat strip beneath: Return · Sharpe · Max DD · Win rate · Profit factor. Replaces the old two-row 14-metric wall.
2. **Performance** — Price chart with symbol pill-tabs, equity curve, drawdown ribbon, monthly returns, and right-rail (Effective Risk panel + Deploy CTA). A `+ show additional metrics` toggle reveals Sortino / CAGR / Volatility / DD duration on demand (state: `showAllMetrics`).
3. **Trade Economics** — Quiet 5-stat strip (Avg win / Avg loss / Largest win / Largest loss / Avg hold) followed by interactive charts: `PnLHistogram`, `HoldTimeHistogram`, `ExitReasonDonut`. Clicking a bar or slice cross-filters the trade log; click the same element again to clear. State: `pnlBinFilter`, `holdBucketFilter`, `exitReasonFilter`. `clearAllCrossFilters()` resets all three.
4. **Trade Log** — `TerminalTable` with `all / wins / losses` pills. Pill counts reflect the cross-filtered set so the totals stay coherent when histogram/donut filters are active.

**Editorial verdict — `computeVerdict(result)`:**
- < 10 trades → `Insufficient sample.`
- Return > 0, Sharpe > 1, MaxDD < 10% → `Promising strategy.`
- Return > 0, Sharpe ≥ 0 → `Marginal strategy.`
- Return > 0, Sharpe < 0 → `Profitable but volatile.`
- Return ≤ 0, Profit factor > 1 → `Losing run, but trade quality holds.`
- Return ≤ 0 otherwise → `Strategy underperforms.`

**B2 cross-filter chain (`crossFilteredIndices`):** filters compose AND-style. Predicates match the bucketers in `computePnlHistogram` / `computeHoldBuckets` / `computeExitReasonBreakdown` so clicking a chart bar selects exactly the trades that bar represents. The outcome filter (`all`/`wins`/`losses`) applies last.

**BT5/BT7/BT8 integration (2026-05-16):**
- `useBacktestChartSeries(strategyId, backtestId)` fetches chart data
- `focusedTradeIndex: number | null` state threads from the trade log click handler into `BacktestPriceChart`
- `BacktestPriceChart` is dynamically imported (`ssr: false`)
- Pill-tab symbol selector: when `chartData.series.length > 1`, renders symbol tabs; selected symbol's `bars` + filtered `trades` are passed to `BacktestPriceChart`
- `getRowBackground` on `TerminalTable` highlights the focused trade row with a subtle tint

**Proxy route:** `app/app/api/strategies/[id]/backtests/[backtestId]/chart-series/route.ts` forwards the request to `GET /strategies/{id}/backtests/{backtestId}/chart-series` on the Railway backend with the user's auth token.

---

## Theme System

### ThemeProvider — `app/components/theme.tsx`

Custom React context provider (no `next-themes` dependency). Wraps the entire app via `app/layout.tsx`.

- **Palettes**: `PAPER` (light, warm cream) and `AMBER` (dark, Bloomberg-style). Stored in `PALETTES: Record<Mode, Palette>`.
- **Tokens**: `useT()` returns `Tokens` — all palette values plus `fontSans`, `fontHead`, `fontMono` CSS variable references.
- **Default**: system preference via `window.matchMedia("(prefers-color-scheme: dark)")`. Falls back to `light` on SSR.
- **Persistence**: manual selection is written to `localStorage` at key `"psxalgos-theme"`. Live OS-preference updates only apply when no manual selection is stored.
- **SSR safety**: `layout.tsx` injects an inline blocking `<script>` (`themeInit`) that sets `data-theme` on `<html>` before React hydrates — eliminates the Paper→Amber flash on first paint. `ThemeProvider` reads the same key on mount.
- **CSS integration**: `globals.css` defines all design tokens as CSS custom properties under `:root` (Paper) and `[data-theme="dark"]` (Amber). Server components and plain CSS rules can consume `var(--surface)`, `var(--text)`, etc. without touching `useT()`.
- **Favicon sync**: `ThemeProvider` retargets `<link rel="icon">` to `/icon-paper.svg` or `/icon-amber.svg` on each mode change.

### ThemeToggle — `app/components/frame.tsx`

Inline pill toggle (`variant="inline"`) rendered in the desktop top nav and inside the mobile More drawer. Two buttons: "☀ Paper" / "◐ Amber". Active button has a subtle surface background; inactive is muted text.

---

## Mobile Navigation

### BottomTabBar + MoreDrawer — `app/components/frame.tsx`

On mobile viewports (`isMobile` from `useBreakpoint`), `AppFrame` renders a fixed bottom tab bar instead of a hamburger.

- **Primary tabs** (`BOTTOM_PRIMARY`): Strategies, Signals, Bots, Backtest — 4 tabs with SVG icons + labels.
- **More button**: 5th slot with a three-dot icon. Opens `MoreDrawer`.
- **MoreDrawer**: full-width bottom sheet with backdrop. Contains overflow items (`MORE_DRAWER_ITEMS`): Portfolio, Leaderboard, Notifications, Pricing. Also shows a KSE-100 ticker row and `ThemeToggle`.
- **Active state**: active tab/drawer item highlighted with `T.primaryLight` color + `fontWeight: 600`. Active pill background uses `T.primaryContainer + "22"` tint.
- **Dismiss**: tap backdrop, `Escape` key, or tapping a nav link (each `Link` calls `onClose`).
- **Safe area**: bar height is `calc(56px + env(safe-area-inset-bottom))`; `AppFrame` main content adds matching `paddingBottom` so content is never occluded.
- **Hamburger**: tablet-only (compact, non-mobile). Mobile suppresses the hamburger button entirely.

---

## Typography / Fonts

IBM Plex Sans (`--font-plex-sans`), IBM Plex Mono (`--font-plex-mono`), and Space Grotesk (`--font-space-grotesk`) are loaded via `next/font/google` in `layout.tsx` and applied as CSS variables on `<html>`. `useT()` exposes them as `fontSans`, `fontMono`, `fontHead` for inline styles.

---

## API Proxy Pattern

All routes in `app/app/api/` forward to the Railway backend with the NextAuth session token attached as `Authorization: Bearer <token>`. The proxy layer exists so the backend URL and Railway credentials never reach the browser.

---

## BFF Routes Reference

### `GET /api/auth/ws-token` — `app/app/api/auth/ws-token/route.ts`

Mints a short-lived backend JWT (5 min, HS256, audience `authenticated`) for opening a browser WebSocket to FastAPI's `/ws` endpoint. The browser can't read NextAuth's secret, so the token is signed server-side off the active session via `signBackendJwt` (`app/lib/api/jwt.ts`).

**Responses:**
- `200 { token, ws_url, expires_in }` — `ws_url` is derived from `NEXT_PUBLIC_API_BASE_URL` by stripping `/api/v1` and converting `http(s)` → `ws(s)`.
- `401 { error: "unauthorized" }` — no session.
- `500 { error }` — `NEXTAUTH_SECRET` or `NEXT_PUBLIC_API_BASE_URL` missing.

`Cache-Control: no-store` — tokens are single-use per session start.

Consumers: `lib/api/backtest-watcher.ts::watchBacktestJob`.

### `POST /api/contact` — `app/app/api/contact/route.ts`

Public contact-form sender. Does NOT forward to the Railway backend — sends email directly via Resend.

**Body (JSON):**
```ts
{
  name: string;        // required, 1–100
  email: string;       // required, RFC 5322 subset, 1–200
  subject?: string;    // optional, 0–200
  message: string;     // required, 10–5000
  website?: string;    // honeypot — must be empty
}
```

**Responses:**
- `200 { ok: true }` — accepted by Resend (or silently dropped honeypot hit)
- `400 { error }` — validation failure (name/email/message missing or out of bounds)
- `502 { error }` — Resend rejected or threw; visitor sees a hint to email `support@` directly
- `503 { error }` — `RESEND_API_KEY` not configured on the server

**Env vars (Vercel — set on both Production and Preview):**
- `RESEND_API_KEY` *(required)* — from resend.com dashboard. Starts with `re_`.
- `CONTACT_FROM` *(optional)* — sender. Default `PSX Algos <onboarding@resend.dev>` (Resend's sandbox, only delivers to the account email). Production value: `PSX Algos <noreply@psxalgos.com>` once the domain is verified in Resend.
- `CONTACT_TO` *(optional)* — recipient. Default `support@psxalgos.com`.

**Behaviour notes:**
- `replyTo` is set to the submitter's email so when the maintainer hits "Reply" in Zoho, the message threads back to the visitor instead of the noreply mailbox.
- HTML body is constructed with manual escaping (`escapeHtml`) — never inject form input into the HTML template unsanitised.
- Resend errors are logged server-side (`console.error("[contact] ...")`) but never leaked to the client — visitors always see a generic recoverable message.
- Honeypot returns 200 (not 4xx) so bots don't escalate to a more aggressive strategy.

**DNS / mail-routing context (Resend + Zoho coexist):**
- Resend uses the `send.psxalgos.com` subdomain for bounce handling — separate from the root MX (which Zoho owns for `support@`, `info@`, `basim@` inboxes).
- DKIM/SPF/DMARC records added via Cloudflare auto-configure.
- **Do not enable Resend's "Enable Receiving"** — it would overwrite Zoho's root MX and break all inbound mail.

---

> **Removed 2026-05-18:** `/alerts`, `/watchlists`, and `/market` pages plus their BFF routes (`api/alerts/*`, `api/watchlist/*`, `api/market/*`), hooks (`use-alerts.ts`, `use-watchlists.ts`, `use-market.ts`), and clients (`lib/api/alerts.ts`, `lib/api/watchlists.ts`, `lib/api/market.ts`) were deleted from psx-ui. Backend routers (`backend/app/routers/alerts.py`, `backend/app/routers/watchlists.py`, `backend/app/routers/market.py`) and their DB tables remain live but unreachable from the deployed UI — cheap to revive if any surface returns. Decisions: alerts collapse into strategies (user expresses any rule as a strategy and deploys it); watchlists deprioritised to keep nav focused on the signal → strategy → bot loop; market overview page deferred — KSE-100 headline already lives in the global top bar.
