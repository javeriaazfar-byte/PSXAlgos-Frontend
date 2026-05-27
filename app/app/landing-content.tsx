"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useT } from "@/components/theme";
import { MarketingNav, SkipLink } from "@/components/frame";
import { useFlash } from "@/components/atoms";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";

export default function LandingContent() {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.pageMarketing);
  const howItWorksRef = useRef<HTMLDivElement>(null);
  const { flash, setFlash } = useFlash();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#how-it-works") {
      howItWorksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const scrollToHowItWorks = useCallback(() => {
    howItWorksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const comingSoon = useCallback((feature: string) => {
    setFlash(`${feature} — coming soon`);
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.surface,
        color: T.text,
        fontFamily: T.fontSans,
        fontSize: 14,
        position: "relative",
      }}
    >
      <SkipLink />
      <MarketingNav />

      <main id="main-content">
      {/* Hero */}
      <div
        style={{
          padding: pick(bp, {
            mobile: `40px ${padX} 32px`,
            tablet: `56px ${padX} 44px`,
            desktop: `80px ${padX} 60px`,
          }),
          display: "grid",
          gridTemplateColumns: pick(bp, { mobile: "1fr", tablet: "1fr", desktop: "1.15fr 1fr" }),
          gap: pick(bp, { mobile: 32, tablet: 40, desktop: 64 }),
          alignItems: "center",
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: T.fontMono,
              fontSize: 11,
              color: T.primaryLight,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: T.primary,
                color: T.surface,
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: 0.8,
              }}
            >
              BETA
            </span>
            <span style={{ width: 20, height: 1, background: T.primaryLight }} />
            Built for the PSX · Karachi, Lahore, Islamabad
          </div>
          <h1
            style={{
              fontFamily: T.fontHead,
              fontSize: clampPx(40, 9, 76),
              fontWeight: 500,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              margin: "22px 0 24px",
              color: T.text,
            }}
          >
            Write strategies.
            <br />
            <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>
              Not code.
            </span>
          </h1>
          <p
            style={{
              fontSize: pick(bp, { mobile: 15, desktop: 17 }),
              color: T.text2,
              lineHeight: 1.55,
              maxWidth: 560,
              margin: 0,
            }}
          >
            Build a trading strategy as a tree of conditions — RSI oversold, volume surges, trend
            reversals — backtest it on a decade of PSX data, then deploy it as a signal feed or a
            paper-trading bot. No Python, no brokers, no mess.
          </p>
          <div
            style={{
              marginTop: 32,
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/strategies"
              style={{
                fontFamily: T.fontHead,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: -0.2,
                padding: "14px 24px",
                borderRadius: 6,
                background: T.primary,
                color: T.surface,
              }}
            >
              Try it →
            </Link>
            <button
              type="button"
              onClick={scrollToHowItWorks}
              style={{
                fontFamily: T.fontHead,
                fontSize: 15,
                fontWeight: 500,
                padding: "14px 20px",
                color: T.text2,
                cursor: "pointer",
                background: "transparent",
                border: "none",
              }}
            >
              ↳ See it in action
            </button>
          </div>
          <div
            style={{
              marginTop: 28,
              display: "flex",
              gap: 24,
              fontFamily: T.fontMono,
              fontSize: 11,
              color: T.text3,
              flexWrap: "wrap",
            }}
          >
            <span>✓ Built for PSX</span>
            <span>✓ 10 years of data</span>
            <span>✓ Sign in with Google</span>
          </div>
        </div>

        {/* Hero art — mini strategy flow */}
        <div
          style={{
            padding: isMobile ? 18 : 28,
            background: T.surfaceLow,
            borderRadius: 10,
            border: `1px solid ${T.outlineFaint}`,
            fontFamily: T.fontMono,
            boxShadow: `0 20px 60px -30px ${
              T.mode === "dark" ? "rgba(0,0,0,0.7)" : "rgba(26,24,21,0.15)"
            }`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 10.5,
              color: T.text3,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            <span>demo · rsi_bounce_v1</span>
            <span style={{ color: T.text3 }}>● example</span>
          </div>
          <svg
            viewBox="0 0 380 280"
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{ display: "block", height: "auto", maxHeight: 320 }}
          >
            {/* Condition 1 */}
            <rect x="10" y="30" width="130" height="52" rx="6" fill={T.surface} stroke={T.primary} strokeWidth="1.5" />
            <text x="22" y="50" fontFamily={T.fontMono} fontSize="10" fill={T.text3} letterSpacing="0.5">
              CONDITION
            </text>
            <text x="22" y="70" fontFamily={T.fontHead} fontSize="13" fontWeight="500" fill={T.text}>
              RSI(14) &lt; 30
            </text>

            {/* Condition 2 */}
            <rect x="10" y="110" width="130" height="52" rx="6" fill={T.surface} stroke={T.primary} strokeWidth="1.5" />
            <text x="22" y="130" fontFamily={T.fontMono} fontSize="10" fill={T.text3} letterSpacing="0.5">
              CONDITION
            </text>
            <text x="22" y="150" fontFamily={T.fontHead} fontSize="13" fontWeight="500" fill={T.text}>
              Vol &gt; 1.5× avg
            </text>

            {/* Connectors: conditions → AND hub (stop before the glyph) */}
            <path d="M 140 56 C 158 56 162 96 170 96" stroke={T.outline} strokeWidth="1.2" fill="none" />
            <path d="M 140 136 C 158 136 162 96 170 96" stroke={T.outline} strokeWidth="1.2" fill="none" />

            {/* AND gate glyph */}
            <text
              x="193"
              y="100"
              textAnchor="middle"
              fontFamily={T.fontHead}
              fontStyle="italic"
              fontSize="20"
              fill={T.primaryLight}
              fontWeight="400"
            >
              AND
            </text>

            {/* Connectors: AND hub → outputs (fan from single apex) */}
            <path d="M 218 96 C 226 96 232 54 240 54" stroke={T.outline} strokeWidth="1.2" fill="none" />
            <path d="M 218 96 C 226 96 232 120 240 120" stroke={T.outline} strokeWidth="1.2" fill="none" />
            <path d="M 218 96 C 226 96 232 186 240 186" stroke={T.outline} strokeWidth="1.2" fill="none" />

            {/* Output: Backtest */}
            <rect x="240" y="30" width="130" height="48" rx="6" fill={T.primary + "22"} stroke={T.primary} strokeWidth="1" />
            <text x="252" y="50" fontFamily={T.fontMono} fontSize="9.5" fill={T.primary} letterSpacing="0.5">
              ⎈ BACKTEST
            </text>
            <text x="252" y="67" fontFamily={T.fontHead} fontSize="13" fontWeight="500" fill={T.gain}>
              +14.2%
            </text>

            {/* Output: Signals */}
            <rect x="240" y="96" width="130" height="48" rx="6" fill={T.deploy + "22"} stroke={T.deploy} strokeWidth="1" />
            <text x="252" y="116" fontFamily={T.fontMono} fontSize="9.5" fill={T.deploy} letterSpacing="0.5">
              ◉ SIGNALS
            </text>
            <text x="252" y="133" fontFamily={T.fontHead} fontSize="13" fontWeight="500" fill={T.text}>
              3 today
            </text>

            {/* Output: Bot */}
            <rect x="240" y="162" width="130" height="48" rx="6" fill={T.accent + "22"} stroke={T.accent} strokeWidth="1" />
            <text x="252" y="182" fontFamily={T.fontMono} fontSize="9.5" fill={T.accent} letterSpacing="0.5">
              ◇ BOT
            </text>
            <text x="252" y="199" fontFamily={T.fontHead} fontSize="13" fontWeight="500" fill={T.gain}>
              +12.4%
            </text>

            {/* Equity curve — shape modeled on KSE-100 Mar 22 → Apr 21, 2026 */}
            <g transform="translate(10, 234)">
              <text x="0" y="0" fontFamily={T.fontMono} fontSize="10" fill={T.text3} letterSpacing="0.5">
                EQUITY · LAST 30D
              </text>
              <text x="360" y="0" textAnchor="end" fontFamily={T.fontMono} fontSize="10" fill={T.gain}>
                +13.3%
              </text>
              <polyline
                points="0,38 12,35.7 24,34 36,32.3 48,33.7 60,37.1 72,34.9 84,31.4 96,29.1 108,29.4 120,33.7 132,30 144,26 156,28 168,24.3 180,20.3 192,17.7 204,22.3 216,18.6 228,20.9 240,16.6 252,11.7 264,7.1 276,10.9 288,8.9 300,5.2 312,7.1 324,3.1 336,0.9 348,1.1 360,0"
                fill="none"
                stroke={T.gain}
                strokeWidth="1.5"
              />
            </g>
          </svg>
        </div>
      </div>

      {/* Three pillars */}
      <div
        style={{
          padding: pick(bp, {
            mobile: `44px ${padX}`,
            desktop: `60px ${padX}`,
          }),
          borderTop: `1px solid ${T.outlineFaint}`,
        }}
      >
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            color: T.primaryLight,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          ── the three outputs
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: pick(bp, {
              mobile: "1fr",
              tablet: "1fr 1fr",
              desktop: "1fr 1fr 1fr",
            }),
            gap: 1,
            background: T.outlineFaint,
          }}
        >
          {(
            [
              [
                "⎈",
                T.primary,
                "Backtest",
                "Run your strategy on a decade of PSX history. Get Sharpe, drawdown, sector breakdown, and every simulated trade. 14ms compute on a year of data.",
              ],
              [
                "◉",
                T.deploy,
                "Signals",
                "Deploy to a real-time feed. When your conditions fire, you get a notification with entry, stop, and target. Log the trade if you take it.",
              ],
              [
                "◇",
                T.accent,
                "Bot",
                "Spin up a paper-trading runner bound to the strategy. It manages a simulated portfolio and shows you what would have happened.",
              ],
            ] as const
          ).map(([g, c, t, d]) => (
            <div key={t} style={{ background: T.surface, padding: pick(bp, { mobile: 22, desktop: 28 }) }}>
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: c + "22",
                  color: c,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: T.fontHead,
                  fontSize: 22,
                }}
              >
                {g}
              </span>
              <h3
                style={{
                  fontFamily: T.fontHead,
                  fontSize: 22,
                  fontWeight: 500,
                  margin: "18px 0 10px",
                  letterSpacing: -0.3,
                }}
              >
                {t}
              </h3>
              <p style={{ fontSize: 13.5, color: T.text2, lineHeight: 1.6, margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div
        id="how-it-works"
        ref={howItWorksRef}
        style={{
          padding: pick(bp, {
            mobile: `44px ${padX}`,
            desktop: `60px ${padX}`,
          }),
          borderTop: `1px solid ${T.outlineFaint}`,
          scrollMarginTop: 20,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: pick(bp, {
              mobile: "1fr",
              tablet: "1fr 1.4fr",
              desktop: "1fr 1.4fr",
            }),
            gap: pick(bp, { mobile: 28, tablet: 40, desktop: 60 }),
          }}
        >
          <div>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
                color: T.primaryLight,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              ── how it works
            </div>
            <h2
              style={{
                fontFamily: T.fontHead,
                fontSize: clampPx(32, 6, 44),
                fontWeight: 500,
                letterSpacing: "-0.02em",
                margin: "0 0 16px",
                lineHeight: 1.05,
              }}
            >
              Four steps,{" "}
              <span style={{ fontStyle: "italic", color: T.primaryLight }}>zero code.</span>
            </h2>
            <p style={{ fontSize: 14, color: T.text2, lineHeight: 1.6, maxWidth: 420 }}>
              Most of our users build their first strategy in under ten minutes. The hard part is
              deciding what edge you believe in — we make expressing it trivial.
            </p>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 1, background: T.outlineFaint }}
          >
            {(
              [
                ["01", "Start from a preset", "Mean reversion, momentum breakout, golden cross, MACD — or blank canvas."],
                ["02", "Wire your conditions", "Drag indicators, set thresholds, gate with AND / OR. See it as a flow, not code."],
                ["03", "Backtest in one click", "KSE-100 over 10 years, with sector attribution and full trade log."],
                ["04", "Deploy · signals or bot", "Fork the strategy to a live signal feed or bind a paper-trading bot. Or both."],
              ] as const
            ).map(([n, t, d]) => (
              <div
                key={n}
                style={{
                  background: T.surface,
                  padding: pick(bp, { mobile: "16px 18px", desktop: "18px 22px" }),
                  display: "flex",
                  gap: pick(bp, { mobile: 14, desktop: 20 }),
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontFamily: T.fontHead,
                    fontStyle: "italic",
                    fontSize: 32,
                    fontWeight: 300,
                    color: T.primaryLight,
                    letterSpacing: -0.5,
                    minWidth: 44,
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {n}
                </span>
                <div>
                  <div
                    style={{ fontFamily: T.fontHead, fontSize: 16, fontWeight: 500, letterSpacing: -0.2 }}
                  >
                    {t}
                  </div>
                  <div style={{ fontSize: 12.5, color: T.text3, marginTop: 4, lineHeight: 1.55 }}>
                    {d}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live stats strip */}
      <div
        style={{
          padding: pick(bp, { mobile: `36px ${padX}`, desktop: `48px ${padX}` }),
          borderTop: `1px solid ${T.outlineFaint}`,
          background: T.surfaceLow,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: pick(bp, {
              mobile: "1fr 1fr",
              tablet: "repeat(4, 1fr)",
              desktop: "repeat(4, 1fr)",
            }),
            gap: pick(bp, { mobile: 24, desktop: 40 }),
          }}
        >
          {(
            [
              ["PSX coverage", "All listed", "EOD + intraday"],
              ["Indicators", "30+", "MACD · RSI · BB · ATR …"],
              ["Data since", "2015", "10+ years of PSX history"],
              ["Backtest engine", "10 yrs / run", "or any subset"],
            ] as const
          ).map(([l, v, s]) => (
            <div key={l}>
              <div
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 10.5,
                  color: T.text3,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {l}
              </div>
              <div
                style={{
                  fontFamily: T.fontHead,
                  fontSize: clampPx(26, 5, 36),
                  fontWeight: 500,
                  letterSpacing: -0.6,
                  color: T.text,
                }}
              >
                {v}
              </div>
              <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3, marginTop: 4 }}>
                {s}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          padding: pick(bp, { mobile: `44px ${padX}`, desktop: `60px ${padX}` }),
          borderTop: `1px solid ${T.outlineFaint}`,
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(32, 7, 48),
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: 0,
            lineHeight: 1.05,
          }}
        >
          Build your first strategy in{" "}
          <span style={{ fontStyle: "italic", color: T.primaryLight }}>minutes</span>.
        </h2>
        <p style={{ fontSize: 14.5, color: T.text2, marginTop: 14, marginBottom: 28 }}>
          No code, no broker setup. Sign in with Google, pick a template, hit backtest.
        </p>
        <Link
          href="/strategies"
          style={{
            display: "inline-block",
            fontFamily: T.fontHead,
            fontSize: 15,
            fontWeight: 600,
            padding: "16px 28px",
            borderRadius: 6,
            background: T.primary,
            color: T.surface,
          }}
        >
          Try it →
        </Link>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: pick(bp, { mobile: `20px ${padX}`, desktop: `24px ${padX}` }),
          borderTop: `1px solid ${T.outlineFaint}`,
          display: "flex",
          alignItems: "center",
          fontFamily: T.fontMono,
          fontSize: 11,
          color: T.text3,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>© 2026 PSX Algos · Karachi</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <button type="button" onClick={() => comingSoon("Privacy policy")} style={footerLinkStyle(T)}>
            Privacy
          </button>
          <button type="button" onClick={() => comingSoon("Terms of service")} style={footerLinkStyle(T)}>
            Terms
          </button>
          <button type="button" onClick={() => comingSoon("Status page")} style={footerLinkStyle(T)}>
            Status
          </button>
        </div>
      </div>
      </main>

      {flash && <LandingFlashToast message={flash} />}
    </div>
  );
}

function footerLinkStyle(T: ReturnType<typeof useT>) {
  return {
    background: "transparent",
    border: "none",
    padding: 0,
    fontFamily: T.fontMono,
    fontSize: 11,
    color: T.text3,
    cursor: "pointer",
  } as const;
}

function LandingFlashToast({ message }: { message: string }) {
  const T = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 72,
        left: "50%",
        transform: "translateX(-50%)",
        background: T.surface2,
        color: T.text,
        padding: "10px 18px",
        borderRadius: 999,
        boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 12px 40px -12px rgba(0,0,0,0.5)`,
        fontFamily: T.fontMono,
        fontSize: 12,
        zIndex: 1000,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ color: T.primaryLight }}>◉</span>
      {message}
    </div>
  );
}
