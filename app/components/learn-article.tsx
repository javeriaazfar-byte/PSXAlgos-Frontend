"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { useT } from "@/components/theme";
import { AppFrame } from "@/components/frame";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";
import type { Block, GlossaryEntry } from "@/app/learn/_content/types";

// Minimal inline parser: **bold** and [label](/href). Deliberately tiny — the
// content model is typed data, not arbitrary markdown, so we only support the
// two inline forms our pages actually use.
function renderInline(text: string, key: string): ReactNode {
  const nodes: ReactNode[] = [];
  // Split on **bold** and [label](href) while keeping the delimiters.
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(re);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(
        <strong key={`${key}-${i}`} style={{ fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
      return;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      nodes.push(
        <Link key={`${key}-${i}`} href={link[2]} style={{ color: "inherit", textDecoration: "underline" }}>
          {link[1]}
        </Link>
      );
      return;
    }
    nodes.push(<Fragment key={`${key}-${i}`}>{part}</Fragment>);
  });
  return nodes;
}

function BlockView({ block, idx }: { block: Block; idx: number }) {
  const T = useT();
  const key = `b${idx}`;
  switch (block.kind) {
    case "para":
      return (
        <p style={{ fontSize: 16, lineHeight: 1.7, color: T.text2, margin: "0 0 18px" }}>
          {renderInline(block.text, key)}
        </p>
      );
    case "heading":
      return (
        <h2
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(20, 3, 28),
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: T.text,
            margin: "36px 0 14px",
          }}
        >
          {block.text}
        </h2>
      );
    case "list":
      return block.ordered ? (
        <ol style={{ margin: "0 0 18px", paddingLeft: 22, color: T.text2 }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ fontSize: 16, lineHeight: 1.7, marginBottom: 8 }}>
              {renderInline(it, `${key}-${i}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul style={{ margin: "0 0 18px", paddingLeft: 22, color: T.text2 }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ fontSize: 16, lineHeight: 1.7, marginBottom: 8 }}>
              {renderInline(it, `${key}-${i}`)}
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <figure style={{ margin: "0 0 22px" }}>
          <div style={{ overflowX: "auto", border: `1px solid ${T.outlineVariant}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {block.headers.map((h, i) => (
                    <th
                      key={i}
                      style={{
                        textAlign: i === 0 ? "left" : "right",
                        padding: "10px 14px",
                        background: T.surface3,
                        color: T.text,
                        fontWeight: 600,
                        fontFamily: T.fontMono,
                        fontSize: 12,
                        letterSpacing: 0.3,
                        borderBottom: `1px solid ${T.outlineVariant}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        style={{
                          textAlign: c === 0 ? "left" : "right",
                          padding: "10px 14px",
                          color: c === 0 ? T.text : T.text2,
                          fontFamily: c === 0 ? T.fontSans : T.fontMono,
                          borderBottom: r === block.rows.length - 1 ? "none" : `1px solid ${T.outlineFaint}`,
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <figcaption style={{ fontSize: 12, color: T.text3, marginTop: 8, fontStyle: "italic" }}>
              {block.caption}
            </figcaption>
          )}
        </figure>
      );
    case "callout":
      return (
        <div
          style={{
            margin: "0 0 22px",
            padding: "14px 16px",
            borderRadius: 8,
            background: block.tone === "warn" ? `${T.warning}14` : T.surfaceLow,
            borderLeft: `3px solid ${block.tone === "warn" ? T.warning : T.primaryLight}`,
            color: T.text2,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {renderInline(block.text, key)}
        </div>
      );
  }
}

export function LearnArticle({ entry }: { entry: GlossaryEntry }) {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.pageMarketing);

  return (
    <AppFrame>
      <div
        style={{ padding: `28px ${padX} 80px`, maxWidth: 760, margin: "0 auto", width: "100%" }}
      >
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          style={{ fontFamily: T.fontMono, fontSize: 12, color: T.text3, marginBottom: 18 }}
        >
          <Link href="/learn" style={{ color: T.text3, textDecoration: "none" }}>
            Learn
          </Link>
          <span style={{ margin: "0 8px" }}>/</span>
          <span style={{ color: T.text2 }}>{entry.term}</span>
        </nav>

        <h1
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(30, 5, 46),
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            color: T.text,
            margin: "0 0 18px",
          }}
        >
          {entry.term}
        </h1>

        {/* TL;DR — the citation-ready one-sentence definition */}
        <div
          style={{
            padding: "16px 18px",
            borderRadius: 10,
            background: T.surfaceLow,
            border: `1px solid ${T.outlineVariant}`,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              fontFamily: T.fontMono,
              fontSize: 11,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: T.primaryLight,
              marginBottom: 6,
            }}
          >
            In one line
          </div>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: T.text, margin: 0 }}>
            {renderInline(entry.tldr, "tldr")}
          </p>
        </div>

        {/* Body */}
        {entry.body.map((block, i) => (
          <BlockView key={i} block={block} idx={i} />
        ))}

        {/* Product tie-in */}
        {entry.productTieIn && (
          <section
            style={{
              marginTop: 36,
              padding: "20px 22px",
              borderRadius: 12,
              background: T.primaryContainer + "12",
              border: `1px solid ${T.primaryLight}40`,
            }}
          >
            <h2
              style={{
                fontFamily: T.fontHead,
                fontSize: 19,
                fontWeight: 600,
                color: T.text,
                margin: "0 0 12px",
              }}
            >
              {entry.productTieIn.heading}
            </h2>
            {entry.productTieIn.blocks.map((block, i) => (
              <BlockView key={i} block={block} idx={1000 + i} />
            ))}
            <Link
              href={entry.productTieIn.cta?.href ?? "/strategies/new"}
              style={{
                display: "inline-block",
                marginTop: 4,
                fontFamily: T.fontMono,
                fontSize: 13,
                fontWeight: 600,
                color: T.primaryLight,
                textDecoration: "none",
              }}
            >
              {entry.productTieIn.cta?.label ?? "Build a strategy →"}
            </Link>
          </section>
        )}

        {/* FAQ */}
        {entry.faqs.length > 0 && (
          <section style={{ marginTop: 44 }}>
            <h2
              style={{
                fontFamily: T.fontHead,
                fontSize: clampPx(22, 3, 30),
                fontWeight: 600,
                color: T.text,
                margin: "0 0 20px",
              }}
            >
              Frequently asked
            </h2>
            {entry.faqs.map((f, i) => (
              <div
                key={i}
                style={{
                  padding: "16px 0",
                  borderTop: i === 0 ? `1px solid ${T.outlineVariant}` : "none",
                  borderBottom: `1px solid ${T.outlineVariant}`,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: "0 0 8px" }}>
                  {f.q}
                </h3>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: T.text2, margin: 0 }}>{f.a}</p>
              </div>
            ))}
          </section>
        )}

        {/* Related */}
        {entry.related.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: T.text3,
                marginBottom: 12,
              }}
            >
              Related terms
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {entry.related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/learn/${r.slug}`}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${T.outlineVariant}`,
                    background: T.surface2,
                    color: T.text2,
                    fontSize: 14,
                    textDecoration: "none",
                  }}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Byline */}
        <div
          style={{
            marginTop: 44,
            paddingTop: 18,
            borderTop: `1px solid ${T.outlineFaint}`,
            fontSize: 13,
            color: T.text3,
          }}
        >
          By {entry.author} · Updated{" "}
          {new Date(entry.updated + "T00:00:00Z").toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </div>
      </div>
    </AppFrame>
  );
}
