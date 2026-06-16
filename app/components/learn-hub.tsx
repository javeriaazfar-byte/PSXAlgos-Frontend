"use client";

import Link from "next/link";
import { useT } from "@/components/theme";
import { AppFrame } from "@/components/frame";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";
import type { GlossaryCategory } from "@/app/learn/_content/types";

export interface HubItem {
  slug: string;
  term: string;
  tldr: string;
  category: GlossaryCategory;
}

const CATEGORY_LABEL: Record<GlossaryCategory, string> = {
  index: "Indices",
  structure: "Market structure",
  indicator: "Indicators",
  tax: "Tax & rules",
  account: "Accounts & access",
};

const CATEGORY_ORDER: GlossaryCategory[] = [
  "index",
  "structure",
  "indicator",
  "tax",
  "account",
];

export function LearnHub({ items }: { items: HubItem[] }) {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.pageMarketing);

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <AppFrame>
      <div
        style={{ padding: `36px ${padX} 80px`, maxWidth: 1000, margin: "0 auto", width: "100%" }}
      >
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: T.primaryLight,
            marginBottom: 10,
          }}
        >
          PSX Algos · Learn
        </div>
        <h1
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(32, 5, 52),
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            color: T.text,
            margin: "0 0 16px",
          }}
        >
          Understand the Pakistan Stock Exchange
        </h1>
        <p
          style={{
            fontSize: 17,
            lineHeight: 1.6,
            color: T.text2,
            maxWidth: 620,
            margin: "0 0 48px",
          }}
        >
          The indices, market mechanics, and trading indicators that move the
          PSX — defined clearly, with worked examples, and linked to strategies
          you can build and backtest.
        </p>

        {groups.map((g) => (
          <section key={g.cat} style={{ marginBottom: 44 }}>
            <h2
              style={{
                fontFamily: T.fontMono,
                fontSize: 12,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: T.text3,
                margin: "0 0 16px",
                paddingBottom: 8,
                borderBottom: `1px solid ${T.outlineVariant}`,
              }}
            >
              {CATEGORY_LABEL[g.cat]}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: pick(bp, {
                  mobile: "1fr",
                  tablet: "1fr 1fr",
                  desktop: "1fr 1fr",
                }),
                gap: 14,
              }}
            >
              {g.items.map((it) => (
                <Link
                  key={it.slug}
                  href={`/learn/${it.slug}`}
                  style={{
                    display: "block",
                    padding: "18px 20px",
                    borderRadius: 12,
                    border: `1px solid ${T.outlineVariant}`,
                    background: T.surface2,
                    textDecoration: "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily: T.fontHead,
                      fontSize: 18,
                      fontWeight: 600,
                      color: T.text,
                      marginBottom: 6,
                    }}
                  >
                    {it.term}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.55, color: T.text3 }}>
                    {it.tldr.length > 130 ? it.tldr.slice(0, 127).trimEnd() + "…" : it.tldr}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppFrame>
  );
}
