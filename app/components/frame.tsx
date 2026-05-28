"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useT, useTheme } from "./theme";
import { useBreakpoint, PAD, pick } from "./responsive";
import { LogoMark } from "./logo";
import { AuthModal } from "./auth-modal";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notifications/notification-bell";

type MarketingItem =
  | { kind: "link"; href: string; label: string }
  | { kind: "stub"; label: string };

// `/backtest` (no params) lists every backtest run the user has executed
// across all their strategies, newest first. Clicking a row deep-links to
// `/backtest?strategy_id=N&backtest_id=M` (results display). New runs are
// configured on `/backtest/new` — reachable from the editor's Run backtest
// button or the index's Run new backtest CTA.
const NAV_ITEMS: MarketingItem[] = [
  { kind: "link", href: "/strategies", label: "Strategies" },
  { kind: "link", href: "/backtest", label: "Backtest" },
  { kind: "link", href: "/signals", label: "Signals" },
  { kind: "link", href: "/bots", label: "Bots" },
  { kind: "link", href: "/portfolio", label: "Portfolio" },
  { kind: "link", href: "/leaderboard", label: "Leaderboard" },
];

type BottomTab = { href: string; label: string; icon: ReactNode };

const BOTTOM_PRIMARY: BottomTab[] = [
  {
    href: "/strategies",
    label: "Strategies",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/signals",
    label: "Signals",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 14 L6 10 L9 12 L13 6 L17 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="17" cy="8" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/bots",
    label: "Bots",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="5" y="7" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7V5a2 2 0 1 1 4 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="1" fill="currentColor" />
        <circle cx="12" cy="11" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/backtest",
    label: "Backtest",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 16 L3 8 L7 11 L10 5 L13 9 L17 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const MORE_DRAWER_ITEMS: { href: string; label: string }[] = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/notifications", label: "Notifications" },
  { href: "/pricing", label: "Pricing" },
];

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

// Header KSE-100 chip data. Fetches /api/market/indices (server proxy
// that hits the backend's /market/indices?period=1D) and surfaces the
// percent change. Returns null while loading or on failure so the
// chip can hide gracefully — never show fabricated numbers in the
// header. Refresh every 5 min; the upstream is EOD-derived.
type KseTicker = { changePercent: number } | null;

function useKseTicker(): KseTicker {
  const [data, setData] = useState<KseTicker>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/market/indices", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as Array<{
          symbol: string;
          changePercent: number;
        }>;
        const kse = body.find((row) => row.symbol === "KSE100");
        if (!kse || cancelled) return;
        setData({ changePercent: kse.changePercent });
      } catch {
        // Swallow — leaving data null hides the chip.
      }
    };
    void load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return data;
}

function formatPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function TopNav({ route }: { route?: string }) {
  const T = useT();
  const pathname = usePathname();
  const activeRoute = route || pathname;
  const { isDesktop, isMobile } = useBreakpoint();
  const compact = !isDesktop;
  const [open, setOpen] = useState(false);
  // On mobile the bottom tab bar replaces the hamburger, so only lock scroll
  // for tablet hamburger drawer.
  useBodyScrollLock(open && compact && !isMobile);
  const kse = useKseTicker();

  useEffect(() => {
    if (!compact && open) setOpen(false);
  }, [compact, open]);

  return (
    <header
      style={{
        background: T.surface,
        borderBottom: `1px solid ${T.outlineFaint}`,
        flexShrink: 0,
        position: "relative",
        zIndex: 40,
      }}
    >
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "stretch",
          padding: compact ? "0 16px" : "0 24px",
          gap: compact ? 8 : 0,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginRight: compact ? 0 : 28,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <LogoMark size={20} radius={4} />
          <span style={{ fontFamily: T.fontHead, fontWeight: 600, fontSize: 14, letterSpacing: -0.2 }}>
            PSX{" "}
            <span style={{ fontStyle: "italic", fontWeight: 500, color: T.primaryLight }}>Algos</span>
          </span>
        </Link>

        {!compact && (
          <nav style={{ display: "flex", flex: 1, minWidth: 0 }}>
            {NAV_ITEMS.map((item) => {
              if (item.kind !== "link") return null;
              const active = activeRoute?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href as "/strategies"}
                  style={{
                    padding: "0 16px",
                    fontSize: 12.5,
                    display: "flex",
                    alignItems: "center",
                    color: active ? T.text : T.text3,
                    borderBottom: active ? `2px solid ${T.primaryLight}` : "2px solid transparent",
                    marginBottom: -1,
                    fontFamily: T.fontSans,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        {compact ? (
          <>
            <div style={{ flex: 1 }} />
            {/* KSE ticker stays visible on mobile header even with bottom tab bar */}
            {isMobile && kse && (
              <span style={{ fontFamily: T.fontMono, fontSize: 11, whiteSpace: "nowrap", color: T.text3 }}>
                KSE{" "}
                <span style={{ color: kse.changePercent >= 0 ? T.gain : T.loss }}>
                  {formatPct(kse.changePercent)}
                </span>
              </span>
            )}
            <NotificationBell size={26} />
            <UserMenu size={26} />
            {/* Hamburger is shown on tablet only; mobile uses BottomTabBar */}
            {!isMobile && (
              <button
                type="button"
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  alignSelf: "center",
                  background: "transparent",
                  border: `1px solid ${T.outlineFaint}`,
                  borderRadius: 6,
                  color: T.text,
                  cursor: "pointer",
                }}
              >
                <Hamburger open={open} color={T.text} />
              </button>
            )}
          </>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: T.text3,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            <ThemeToggle variant="inline" />
            {kse && (
              <span style={{ fontFamily: T.fontMono, whiteSpace: "nowrap" }}>
                KSE-100{" "}
                <span
                  style={{ color: kse.changePercent >= 0 ? T.gain : T.loss }}
                >
                  {formatPct(kse.changePercent)}
                </span>
              </span>
            )}
            <Link
              href="/contact"
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
                padding: "6px 12px",
                borderRadius: 999,
                background: "transparent",
                color: T.text2,
                border: `1px solid ${T.outlineFaint}`,
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Feedback
            </Link>
            <NotificationBell size={26} />
            <UserMenu size={26} />
          </div>
        )}
      </div>

      {compact && open && (
        <MobileDrawer
          onClose={() => setOpen(false)}
          items={NAV_ITEMS}
          activeRoute={activeRoute}
          footer={
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ThemeToggle variant="inline" />
              {kse && (
                <div
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: 12,
                    color: T.text3,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>KSE-100</span>
                  <span
                    style={{ color: kse.changePercent >= 0 ? T.gain : T.loss }}
                  >
                    {formatPct(kse.changePercent)}
                  </span>
                </div>
              )}
              <Link
                href="/contact"
                onClick={() => setOpen(false)}
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${T.outlineFaint}`,
                  color: T.text2,
                  textAlign: "center",
                  textDecoration: "none",
                }}
              >
                Feedback
              </Link>
            </div>
          }
        />
      )}
    </header>
  );
}

export function MarketingNav({ badge }: { badge?: string }) {
  const T = useT();
  const { isDesktop, bp } = useBreakpoint();
  const compact = !isDesktop;
  const [authOpen, setAuthOpen] = useState(false);

  // proxy.ts redirects gated routes to /?auth=required&from=<path> when no
  // session. Pop the modal automatically when we land here with that flag,
  // then strip the query so a refresh doesn't re-trigger. Reads
  // window.location directly inside the effect instead of useSearchParams()
  // so static-prerendered pages (e.g. /brand) don't bail out of SSG.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("auth") !== "required") return;
    setAuthOpen(true);
    url.searchParams.delete("auth");
    url.searchParams.delete("from");
    const cleaned = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");
    window.history.replaceState(null, "", cleaned);
  }, []);

  const padX = pick(bp, PAD.pageMarketing);

  return (
    <header
      style={{
        borderBottom: `1px solid ${T.outlineFaint}`,
        background: T.surface,
        position: "relative",
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: compact ? `14px ${padX}` : `22px ${padX}`,
          gap: 12,
        }}
      >
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}
        >
          <LogoMark size={28} radius={6} />
          <span
            style={{
              fontFamily: T.fontHead,
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: -0.3,
            }}
          >
            PSX Algos
          </span>
          {badge && !compact && (
            <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3, marginLeft: 12 }}>
              / {badge}
            </span>
          )}
        </Link>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: compact ? 6 : 10, alignItems: "center" }}>
          <ThemeToggle variant="inline" iconOnly={compact} />
          {!compact && (
            <Link
              href="/contact"
              style={{
                fontFamily: T.fontMono,
                fontSize: 11.5,
                padding: "8px 14px",
                borderRadius: 999,
                background: "transparent",
                color: T.text2,
                border: `1px solid ${T.outlineFaint}`,
                fontWeight: 500,
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Feedback
            </Link>
          )}
          <UserMenu
            size={30}
            fallback={
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11.5,
                  padding: "8px 16px",
                  borderRadius: 999,
                  background: T.primary,
                  color: T.surface,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                Sign in
              </button>
            }
          />
        </div>
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}

function Hamburger({ open, color }: { open: boolean; color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d={open ? "M5 5 L15 15 M15 5 L5 15" : "M3 6 H17 M3 10 H17 M3 14 H17"}
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MobileDrawer({
  onClose,
  items,
  activeRoute,
  onStub,
  footer,
}: {
  onClose: () => void;
  items: MarketingItem[];
  activeRoute?: string | null;
  onStub?: (label: string) => void;
  footer?: ReactNode;
}) {
  const T = useT();
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        background: T.surface,
        borderBottom: `1px solid ${T.outlineFaint}`,
        boxShadow: `0 16px 32px -16px ${
          T.mode === "dark" ? "rgba(0,0,0,0.6)" : "rgba(26,24,21,0.18)"
        }`,
        padding: "8px 16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: "calc(100dvh - 60px)",
        overflowY: "auto",
      }}
    >
      {items.map((item) => {
        if (item.kind === "stub") {
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onStub?.(item.label)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "14px 4px",
                fontFamily: T.fontSans,
                fontSize: 15,
                color: T.text,
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${T.outlineFaint}`,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          );
        }
        const active = activeRoute?.startsWith(item.href);
        return (
          <Link
            key={item.label}
            href={item.href as "/strategies"}
            onClick={onClose}
            style={{
              display: "block",
              padding: "14px 4px",
              fontFamily: T.fontSans,
              fontSize: 15,
              color: active ? T.primaryLight : T.text,
              borderBottom: `1px solid ${T.outlineFaint}`,
              fontWeight: active ? 600 : 400,
            }}
          >
            {item.label}
          </Link>
        );
      })}
      {footer && <div style={{ marginTop: 16 }}>{footer}</div>}
    </div>
  );
}

export function AppFrame({
  children,
  route,
}: {
  children: ReactNode;
  route?: string;
}) {
  const T = useT();
  const { isMobile } = useBreakpoint();
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.surface,
        color: T.text,
        fontFamily: T.fontSans,
        fontSize: 13,
        lineHeight: 1.5,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SkipLink />
      <TopNav route={route} />
      <main
        id="main-content"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          // Reserve space for bottom tab bar on mobile so content isn't occluded.
          paddingBottom: isMobile ? "calc(56px + env(safe-area-inset-bottom))" : undefined,
        }}
      >
        {children}
      </main>
      {isMobile && <BottomTabBar route={route} />}
    </div>
  );
}

// Visually hidden until focused — keyboard users tab once from the address
// bar and can jump straight past the nav. WCAG 2.4.1 Bypass Blocks (Level A).
export function SkipLink() {
  const T = useT();
  return (
    <a
      href="#main-content"
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        padding: "8px 14px",
        background: T.surface2,
        color: T.text,
        borderRadius: 6,
        border: `1px solid ${T.outlineVariant}`,
        fontFamily: T.fontSans,
        fontSize: 13,
        fontWeight: 500,
        zIndex: 9999,
        transform: "translateY(-120%)",
        transition: "transform 140ms ease",
      }}
      onFocus={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.transform = "translateY(-120%)";
      }}
    >
      Skip to main content
    </a>
  );
}

function MoreDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const T = useT();
  const pathname = usePathname();
  const backdropRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 49,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease",
        }}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: T.surface,
          borderTop: `1px solid ${T.outlineVariant}`,
          borderRadius: "16px 16px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 200ms ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* KSE ticker at top of drawer */}
        <KseTickerRow />
        {/* Nav items */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {MORE_DRAWER_ITEMS.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href as "/portfolio"}
                onClick={onClose}
                style={{
                  display: "block",
                  padding: "16px 24px",
                  fontFamily: T.fontSans,
                  fontSize: 15,
                  fontWeight: active ? 600 : 400,
                  color: active ? T.primaryLight : T.text,
                  borderBottom: `1px solid ${T.outlineFaint}`,
                  textDecoration: "none",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        {/* ThemeToggle in drawer footer */}
        <div style={{ padding: "16px 24px" }}>
          <ThemeToggle variant="inline" />
        </div>
      </div>
    </>
  );
}

function KseTickerRow() {
  const T = useT();
  const kse = useKseTicker();
  if (!kse) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 24px",
        borderBottom: `1px solid ${T.outlineVariant}`,
        fontFamily: T.fontMono,
        fontSize: 13,
        color: T.text3,
      }}
    >
      <span>KSE-100</span>
      <span style={{ color: kse.changePercent >= 0 ? T.gain : T.loss, fontWeight: 600 }}>
        {formatPct(kse.changePercent)}
      </span>
    </div>
  );
}

function BottomTabBar({ route }: { route?: string }) {
  const T = useT();
  const pathname = usePathname();
  const activeRoute = route || pathname;
  const [moreOpen, setMoreOpen] = useState(false);

  const moreActive =
    !BOTTOM_PRIMARY.some((t) => activeRoute?.startsWith(t.href)) &&
    MORE_DRAWER_ITEMS.some((t) => activeRoute?.startsWith(t.href));

  return (
    <>
      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} />
      <nav
        aria-label="Primary navigation"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          height: "calc(56px + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
          background: T.surface,
          borderTop: `1px solid ${T.outlineFaint}`,
          display: "flex",
          alignItems: "stretch",
        }}
      >
        {BOTTOM_PRIMARY.map((tab) => {
          const active = activeRoute?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href as "/strategies"}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                color: active ? T.primaryLight : T.text3,
                textDecoration: "none",
                fontFamily: T.fontSans,
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                paddingTop: 6,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: active ? T.primaryContainer + "22" : "transparent",
                  color: active ? T.primaryLight : T.text3,
                  transition: "background 120ms",
                }}
              >
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          );
        })}
        {/* More button */}
        <button
          type="button"
          aria-label="More navigation options"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            color: moreActive ? T.primaryLight : T.text3,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontFamily: T.fontSans,
            fontSize: 10,
            fontWeight: moreActive ? 600 : 400,
            paddingTop: 6,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 8,
              background: moreOpen ? T.primaryContainer + "22" : "transparent",
              color: moreOpen || moreActive ? T.primaryLight : T.text3,
              transition: "background 120ms",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="4" cy="10" r="1.5" fill="currentColor" />
              <circle cx="10" cy="10" r="1.5" fill="currentColor" />
              <circle cx="16" cy="10" r="1.5" fill="currentColor" />
            </svg>
          </span>
          More
        </button>
      </nav>
    </>
  );
}

export function ThemeToggle({
  variant = "floating",
  iconOnly = false,
}: { variant?: "floating" | "inline"; iconOnly?: boolean } = {}) {
  const T = useT();
  const { mode, setMode } = useTheme();
  const darkBg = mode === "dark";
  const inline = variant === "inline";

  const containerStyle = inline
    ? {
        display: "flex",
        alignItems: "center",
        gap: 2,
        background: T.surface3,
        border: `1px solid ${T.outlineFaint}`,
        padding: 2,
        borderRadius: 999,
        fontFamily: T.fontMono,
        fontSize: 10.5,
      }
    : {
        position: "fixed" as const,
        top: 12,
        right: 16,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: darkBg ? "rgba(255,244,220,0.92)" : "rgba(26,24,21,0.92)",
        backdropFilter: "blur(12px)",
        padding: 3,
        borderRadius: 999,
        boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
        fontFamily: 'var(--font-plex-mono), "IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
      };

  return (
    <div style={containerStyle}>
      {(
        [
          ["light", "☀", "Paper"],
          ["dark", "◐", "Amber"],
        ] as const
      ).map(([m, icon, name]) => {
        const active = mode === m;
        const label = iconOnly ? icon : `${icon} ${name}`;
        const buttonStyle = inline
          ? {
              minHeight: 24,
              padding: iconOnly ? "6px 9px" : "6px 12px",
              borderRadius: 999,
              border: "none",
              background: active ? T.surface : "transparent",
              color: active ? T.primaryLight : T.text3,
              fontFamily: "inherit",
              fontSize: "inherit",
              cursor: "pointer",
              letterSpacing: 0.3,
              fontWeight: 600,
              boxShadow: active ? `0 1px 2px ${T.mode === "dark" ? "rgba(0,0,0,0.5)" : "rgba(26,24,21,0.08)"}` : "none",
            }
          : {
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              background: active ? (darkBg ? "#0a0906" : "#f7f3ea") : "transparent",
              color: active
                ? darkBg
                  ? "#d9881a"
                  : "#1f5c3f"
                : darkBg
                ? "rgba(26,24,21,0.72)"
                : "rgba(255,244,220,0.78)",
              fontFamily: "inherit",
              fontSize: "inherit",
              cursor: "pointer",
              letterSpacing: 0.3,
              fontWeight: 600,
            };
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={buttonStyle}
            aria-label={iconOnly ? `Switch to ${name}` : undefined}
            title={iconOnly ? name : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
