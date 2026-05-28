"use client";

import { MarketingNav, SkipLink } from "@/components/frame";
import { useT } from "@/components/theme";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";

const CHANNELS: ReadonlyArray<{
  label: string;
  value: string;
  href: string;
  meta: string;
  for: string;
}> = [
  {
    label: "Product help, bug reports, feedback",
    value: "support@psxalgos.com",
    href: "mailto:support@psxalgos.com",
    meta: "Fastest reply path. Reaches me directly.",
    for: "support",
  },
  {
    label: "General inquiries, partnerships, press",
    value: "info@psxalgos.com",
    href: "mailto:info@psxalgos.com",
    meta: "Anything not strictly product-related.",
    for: "info",
  },
  {
    label: "Phone (Pakistan business hours)",
    value: "+92 334 2153065",
    href: "tel:+923342153065",
    meta: "Text or WhatsApp work too.",
    for: "phone",
  },
];

export default function ContactPage() {
  const T = useT();
  const { bp } = useBreakpoint();
  const padX = pick(bp, PAD.pageMarketing);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.surface,
        color: T.text,
        fontFamily: T.fontSans,
      }}
    >
      <SkipLink />
      <MarketingNav badge="contact" />

      <main
        id="main-content"
        style={{
          padding: pick(bp, {
            mobile: `48px ${padX} 80px`,
            desktop: `80px ${padX} 120px`,
          }),
          maxWidth: 880,
          margin: "0 auto",
        }}
      >
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
          ── get in touch
        </div>
        <h1
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(36, 7, 56),
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            margin: "0 0 18px",
            color: T.text,
          }}
        >
          Send feedback.{" "}
          <span style={{ fontStyle: "italic", color: T.primaryLight, fontWeight: 400 }}>
            Or just say hi.
          </span>
        </h1>
        <p
          style={{
            fontSize: pick(bp, { mobile: 15, desktop: 16.5 }),
            color: T.text2,
            lineHeight: 1.6,
            margin: "0 0 40px",
            maxWidth: 620,
          }}
        >
          PSX Algos is being built and maintained by one person. Every message gets read —
          bug reports, half-formed feature ideas, strategy questions, broker integration
          requests, complaints about the colour scheme. All of it.
        </p>

        <div
          style={{
            display: "grid",
            gap: 1,
            background: T.outlineFaint,
            border: `1px solid ${T.outlineFaint}`,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {CHANNELS.map((ch) => (
            <a
              key={ch.for}
              href={ch.href}
              style={{
                display: "block",
                background: T.surface,
                padding: pick(bp, { mobile: "20px 22px", desktop: "26px 28px" }),
                textDecoration: "none",
                color: "inherit",
                transition: "background 120ms",
              }}
            >
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
                {ch.label}
              </div>
              <div
                style={{
                  fontFamily: T.fontHead,
                  fontSize: pick(bp, { mobile: 20, desktop: 24 }),
                  fontWeight: 500,
                  letterSpacing: -0.3,
                  color: T.primaryLight,
                  wordBreak: "break-all",
                }}
              >
                {ch.value}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: T.text3,
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                {ch.meta}
              </div>
            </a>
          ))}
        </div>

        <div
          style={{
            marginTop: 48,
            padding: pick(bp, { mobile: 20, desktop: 24 }),
            background: T.surfaceLow,
            borderRadius: 10,
            border: `1px solid ${T.outlineFaint}`,
            fontSize: 13.5,
            color: T.text2,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: T.text, fontWeight: 600 }}>One ask:</strong> if you're
          reporting a bug, include the page URL and what you were trying to do. If you're
          suggesting a feature, tell me what problem you're trying to solve — that's almost
          always more useful than the feature itself.
        </div>
      </main>
    </div>
  );
}
