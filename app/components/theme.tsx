"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

// useLayoutEffect on the server logs a warning even though it's a no-op there.
// In SSR builds we fall back to useEffect to silence it. The body of the effect
// below is client-only by construction (reads document) so the distinction is safe.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type Mode = "light" | "dark";

export interface Palette {
  name: string;
  mode: Mode;
  surfaceLowest: string;
  surface: string;
  surfaceLow: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceBright: string;
  primary: string;
  primaryLight: string;
  primaryContainer: string;
  deploy: string;
  deployHover: string;
  deployFg: string;
  gain: string;
  loss: string;
  warning: string;
  accent: string;
  text: string;
  text2: string;
  text3: string;
  outline: string;
  outlineVariant: string;
  outlineFaint: string;
}

export interface Tokens extends Palette {
  fontSans: string;
  fontHead: string;
  fontMono: string;
}

export const FONTS = {
  fontSans: 'var(--font-plex-sans), "IBM Plex Sans", system-ui, sans-serif',
  fontHead: 'var(--font-space-grotesk), "Space Grotesk", sans-serif',
  fontMono: 'var(--font-plex-mono), "IBM Plex Mono", ui-monospace, monospace',
} as const;

const PAPER: Palette = {
  name: "Paper",
  mode: "light",
  surfaceLowest: "#eee9dc",
  surface: "#f7f3ea",
  surfaceLow: "#faf7ee",
  surface2: "#ffffff",
  surface3: "#ece6d6",
  surface4: "#ddd5c1",
  surfaceBright: "#fffcf3",
  primary: "#1f5c3f",
  primaryLight: "#256b48",
  primaryContainer: "#2e8a5f",
  deploy: "#7a2a1a",
  deployHover: "#94331f",
  deployFg: "#ffffff",
  gain: "#1f6b3a",
  loss: "#a8321f",
  warning: "#8a5a12",
  accent: "#6b4a1e",
  text: "#1a1815",
  text2: "#434038",
  text3: "#5f5a4e",
  outline: "#938d7c",
  outlineVariant: "#c9c1ae",
  outlineFaint: "#e2dbca",
};

const AMBER: Palette = {
  name: "Bloomberg Amber",
  mode: "dark",
  surfaceLowest: "#050503",
  surface: "#0a0906",
  surfaceLow: "#100e09",
  surface2: "#15120c",
  surface3: "#1e1a12",
  surface4: "#2a251b",
  surfaceBright: "#322c20",
  primary: "#d9881a",
  primaryLight: "#f2a93a",
  primaryContainer: "#ffc85c",
  deploy: "#1a7d5a",
  deployHover: "#209972",
  deployFg: "#eefff4",
  gain: "#3fd26a",
  loss: "#f05454",
  warning: "#ffb93a",
  accent: "#e6a23a",
  text: "#fff4dc",
  text2: "#d4c9a8",
  text3: "#8a8066",
  outline: "#7a6f55",
  outlineVariant: "#3a3224",
  outlineFaint: "#211d15",
};

export const PALETTES: Record<Mode, Palette> = { light: PAPER, dark: AMBER };

interface ThemeCtx {
  mode: Mode;
  setMode: (m: Mode) => void;
  T: Tokens;
}

const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = "psxalgos-theme";

function osPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialise to "light" so the SSR output and the first client render match —
  // any other initial value would cause a hydration mismatch for inline-styled
  // components reading useT() (e.g. the Sign in button), leaving them stuck on
  // the server-rendered theme until something else triggered a re-render.
  // The themeInit script in app/layout.tsx has already written the correct
  // `data-theme` attribute to <html> from localStorage / OS preference before
  // React hydrates, so we sync React state to that attribute below via a
  // layout effect — runs synchronously before the first paint, so CSS-var
  // surfaces (background, borders) and inline-token surfaces (button bg, text
  // color) land on the same theme in the first visible frame.
  const [mode, setModeState] = useState<Mode>("light");

  useIsomorphicLayoutEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") {
      setModeState(attr);
      return;
    }
    if (osPrefersDark()) setModeState("dark");
  }, []);

  useEffect(() => {
    // Set data-theme on <html>; globals.css reads this via [data-theme="dark"]
    // and swaps all --surface / --text / etc. CSS vars in one paint. This is
    // also what the themeInit blocking script sets pre-hydration, so the
    // DOM attribute is the single source of truth for both server-rendered
    // and client-rendered paths. See PRE_AUTH_DECISIONS.md § ADR-6.
    document.documentElement.setAttribute("data-theme", mode);

    // Sync favicon to the site-theme choice. Layout emits a single `/icon-paper.svg`
    // link by default; we retarget it when mode is dark.
    const href = mode === "dark" ? "/icon-amber.svg" : "/icon-paper.svg";
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
      link.href = href;
    });
  }, [mode]);

  // Live-update when OS preference changes, but only if the user hasn't
  // explicitly chosen a theme yet (localStorage empty = no manual choice).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {}
      setModeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {}
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({
      mode,
      setMode,
      T: { ...PALETTES[mode], ...FONTS },
    }),
    [mode, setMode]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used inside ThemeProvider");
  return v;
}

export function useT(): Tokens {
  return useTheme().T;
}
