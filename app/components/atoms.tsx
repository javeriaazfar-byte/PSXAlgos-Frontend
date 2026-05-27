"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT, type Tokens } from "./theme";
import { useBreakpoint, PAD, pick, clampPx } from "./responsive";
import { Icon } from "./icons";

/* ────────── Buttons ────────── */

type BtnVariant = "primary" | "deploy" | "secondary" | "ghost" | "outline" | "danger";
type BtnSize = "sm" | "md" | "lg";

export function Btn({
  children,
  variant = "secondary",
  size = "md",
  icon,
  style,
  onClick,
  type = "button",
  title,
  disabled,
}: {
  children: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  type?: "button" | "submit";
  title?: string;
  disabled?: boolean;
}) {
  const T = useT();
  const styles: Record<BtnVariant, { bg: string; color: string; border: string }> = {
    primary: { bg: T.primary, color: "#fff", border: T.primary },
    deploy: { bg: T.deploy, color: T.deployFg, border: T.deploy },
    secondary: { bg: T.surface2, color: T.text, border: T.outlineVariant },
    ghost: { bg: "transparent", color: T.text2, border: "transparent" },
    outline: { bg: "transparent", color: T.text, border: T.outlineVariant },
    danger: { bg: "transparent", color: T.loss, border: T.outlineVariant },
  };
  const s = styles[variant];
  const pad = size === "sm" ? "6px 12px" : size === "lg" ? "10px 18px" : "7px 14px";
  const fs = size === "sm" ? 11.5 : size === "lg" ? 13.5 : 12.5;
  const minH = size === "sm" ? 24 : undefined;
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: pad,
        minHeight: minH,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        borderRadius: 4,
        fontSize: fs,
        fontFamily: T.fontSans,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon && <span style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </button>
  );
}

/* ────────── Small atoms ────────── */

export function Chip({
  children,
  color,
  bg,
  style,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  style?: CSSProperties;
}) {
  const T = useT();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        color: color || T.text2,
        background: bg || T.surface3,
        fontFamily: T.fontSans,
        fontWeight: 500,
        letterSpacing: 0.1,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        background: color,
        boxShadow: pulse ? `0 0 0 3px ${color}22` : "none",
        display: "inline-block",
      }}
    />
  );
}

export function KV({
  label,
  value,
  color,
  mono = true,
  dim,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  mono?: boolean;
  dim?: boolean;
}) {
  const T = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: T.text3, letterSpacing: 0.2 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: dim ? T.text2 : color || T.text,
          fontFamily: mono ? T.fontMono : T.fontSans,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const T = useT();
  return (
    <div
      style={{
        fontSize: 10.5,
        color: T.text3,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        fontFamily: T.fontHead,
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}

/* ────────── v2 atoms ────────── */

export function EditorialHeader({
  kicker,
  title,
  meta,
  actions,
}: {
  kicker: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  return (
    <div
      style={{
        padding: pick(bp, {
          mobile: `22px ${padX} 18px`,
          tablet: `28px ${padX} 22px`,
          desktop: `32px ${padX} 24px`,
        }),
        borderBottom: `1px solid ${T.outlineFaint}`,
      }}
    >
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 11,
          color: T.text3,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ width: 20, height: 1, background: T.outline, display: "inline-block" }} />
        {kicker}
      </div>
      <h1
        style={{
          fontFamily: T.fontHead,
          fontSize: clampPx(26, 6, 40),
          fontWeight: 500,
          margin: "10px 0 14px",
          letterSpacing: "-0.02em",
          color: T.text,
          lineHeight: 1.05,
        }}
      >
        {title}
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          gap: isMobile ? 12 : 20,
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 11.5,
            color: T.text3,
            display: "flex",
            gap: 18,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {meta}
        </div>
        {actions && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export function Lede({
  label,
  value,
  color,
  sub,
  size = 40,
  align = "left",
}: {
  label: string;
  value: ReactNode;
  color?: string;
  sub?: ReactNode;
  size?: number | string;
  align?: "left" | "center" | "right";
}) {
  const T = useT();
  return (
    <div style={{ textAlign: align }}>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 10.5,
          color: T.text3,
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: T.fontHead,
          fontSize: size,
          fontWeight: 500,
          color: color || T.text,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.8,
          marginTop: 6,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.text3, marginTop: 8 }}>{sub}</div>
      )}
    </div>
  );
}

export function DotRow({
  label,
  value,
  color,
  bold,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  bold?: boolean;
}) {
  const T = useT();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        fontFamily: T.fontMono,
        fontSize: 12,
        padding: "5px 0",
        color: T.text2,
      }}
    >
      <span style={{ color: T.text3 }}>{label}</span>
      <span
        style={{
          flex: 1,
          borderBottom: `1px dotted ${T.outlineVariant}`,
          margin: "0 4px 4px",
          minWidth: 20,
        }}
      />
      <span
        style={{
          color: color || T.text,
          fontWeight: bold ? 600 : 400,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export interface Col {
  label: string;
  align?: "left" | "center" | "right";
  width?: string;
  mono?: boolean;
  /** Mobile: use this column as the card header. If none is set, column 0 wins. */
  primary?: boolean;
  /** Mobile: omit this column entirely. */
  hideOnMobile?: boolean;
  /** Mobile: render this column as a full-width block (useful for long text or actions). Columns with an empty `label` are treated as this automatically. */
  mobileFullWidth?: boolean;
  /** Allow cell content to wrap. Default: cells are single-line (correct for tabular data). */
  wrap?: boolean;
}

export function TerminalTable<R>({
  cols,
  rows,
  renderCell,
  getRowColor,
  getRowBackground,
  onRowClick,
  minWidth,
}: {
  cols: Col[];
  rows: R[][];
  renderCell?: (cell: R, ci: number, ri: number, col: Col) => ReactNode;
  getRowColor?: (row: R[], ri: number) => string | undefined;
  getRowBackground?: (row: R[], ri: number) => string | undefined;
  onRowClick?: (row: R[], ri: number) => void;
  minWidth?: number;
}) {
  const T = useT();
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <TerminalCards
        cols={cols}
        rows={rows}
        renderCell={renderCell}
        getRowColor={getRowColor}
        getRowBackground={getRowBackground}
        onRowClick={onRowClick}
      />
    );
  }

  const gridTemplate = cols.map((c) => c.width || "1fr").join(" ");
  const resolvedMin =
    minWidth ??
    cols.reduce((acc, c) => {
      const w = c.width;
      if (!w) return acc + 120;
      const m = /^(\d+(?:\.\d+)?)px$/.exec(w);
      if (m) return acc + Number(m[1]);
      const fr = /^(\d+(?:\.\d+)?)fr$/.exec(w);
      if (fr) return acc + Number(fr[1]) * 120;
      return acc + 120;
    }, 0);
  return (
    <div
      style={{
        fontFamily: T.fontMono,
        fontSize: 12,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
    <div style={{ minWidth: resolvedMin }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          padding: "8px 0",
          borderBottom: `1px solid ${T.outlineVariant}`,
          fontSize: 10.5,
          color: T.text3,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {cols.map((c, i) => (
          <div
            key={i}
            style={{
              textAlign: c.align || "left",
              padding: "0 12px",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((row, ri) => {
        const clickable = Boolean(onRowClick);
        const rowBg = (getRowBackground && getRowBackground(row, ri)) ?? undefined;
        return (
          <div
            key={ri}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onRowClick!(row, ri) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick!(row, ri);
                    }
                  }
                : undefined
            }
            style={{
              display: "grid",
              gridTemplateColumns: gridTemplate,
              padding: "10px 0",
              borderBottom: `1px dotted ${T.outlineFaint}`,
              color: (getRowColor && getRowColor(row, ri)) || T.text2,
              background: rowBg ?? "transparent",
              alignItems: "center",
              cursor: clickable ? "pointer" : undefined,
              transition: "background 0.12s",
            }}
            onMouseEnter={
              clickable
                ? (e) => {
                    if (!rowBg) (e.currentTarget as HTMLDivElement).style.background = T.surfaceLow;
                  }
                : undefined
            }
            onMouseLeave={
              clickable
                ? (e) => {
                    (e.currentTarget as HTMLDivElement).style.background = rowBg ?? "transparent";
                  }
                : undefined
            }
          >
            {row.map((cell, ci) => {
              const wrap = cols[ci].wrap;
              // String cells get a native tooltip with the full value so
              // clipped content (ellipsis) stays discoverable. Non-string
              // cells (objects passed through to renderCell — kebab state,
              // OpenPosition, etc.) are skipped to avoid `[object Object]`
              // in the title attribute.
              const titleAttr =
                typeof cell === "string" || typeof cell === "number"
                  ? String(cell)
                  : undefined;
              return (
                <div
                  key={ci}
                  title={titleAttr}
                  style={{
                    textAlign: cols[ci].align || "left",
                    padding: "0 12px",
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: cols[ci].mono === false ? T.fontSans : T.fontMono,
                    whiteSpace: wrap ? "normal" : "nowrap",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: wrap ? "clip" : "ellipsis",
                  }}
                >
                  {renderCell ? renderCell(cell, ci, ri, cols[ci]) : (cell as unknown as ReactNode)}
                </div>
              );
            })}
          </div>
        );
      })}
      </div>
    </div>
  );
}

function TerminalCards<R>({
  cols,
  rows,
  renderCell,
  getRowColor,
  getRowBackground,
  onRowClick,
}: {
  cols: Col[];
  rows: R[][];
  renderCell?: (cell: R, ci: number, ri: number, col: Col) => ReactNode;
  getRowColor?: (row: R[], ri: number) => string | undefined;
  getRowBackground?: (row: R[], ri: number) => string | undefined;
  onRowClick?: (row: R[], ri: number) => void;
}) {
  const T = useT();

  const primaryIdx = (() => {
    const marked = cols.findIndex((c) => c.primary);
    if (marked >= 0) return marked;
    // first visible column (not hidden on mobile, not a footer-only column)
    const first = cols.findIndex(
      (c) => !c.hideOnMobile && c.label !== "" && !c.mobileFullWidth,
    );
    return first >= 0 ? first : 0;
  })();

  const isFooter = (c: Col): boolean =>
    !!c.mobileFullWidth || c.label === "";

  const footerIdxs: number[] = cols
    .map((c, i) => (i !== primaryIdx && !c.hideOnMobile && isFooter(c) ? i : -1))
    .filter((i) => i >= 0);

  const bodyIdxs: number[] = cols
    .map((c, i) =>
      i !== primaryIdx && !c.hideOnMobile && !isFooter(c) ? i : -1,
    )
    .filter((i) => i >= 0);

  return (
    <div
      style={{
        fontFamily: T.fontMono,
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {rows.map((row, ri) => {
        const clickable = Boolean(onRowClick);
        const rowColor = (getRowColor && getRowColor(row, ri)) || T.text2;
        const rowBg = (getRowBackground && getRowBackground(row, ri)) ?? T.surfaceLow;
        const primaryCol = cols[primaryIdx];
        return (
          <div
            key={ri}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onRowClick!(row, ri) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick!(row, ri);
                    }
                  }
                : undefined
            }
            style={{
              padding: 14,
              borderRadius: 8,
              background: rowBg,
              boxShadow: `0 0 0 1px ${T.outlineFaint}`,
              color: rowColor,
              cursor: clickable ? "pointer" : undefined,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div
              style={{
                fontVariantNumeric: "tabular-nums",
                fontFamily: primaryCol.mono === false ? T.fontSans : T.fontMono,
                paddingBottom: bodyIdxs.length || footerIdxs.length ? 10 : 0,
                marginBottom: bodyIdxs.length || footerIdxs.length ? 10 : 0,
                borderBottom:
                  bodyIdxs.length || footerIdxs.length
                    ? `1px solid ${T.outlineFaint}`
                    : undefined,
                fontSize: 14,
                minWidth: 0,
              }}
            >
              {renderCell
                ? renderCell(row[primaryIdx], primaryIdx, ri, primaryCol)
                : (row[primaryIdx] as unknown as ReactNode)}
            </div>

            {bodyIdxs.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  columnGap: 14,
                  rowGap: 8,
                }}
              >
                {bodyIdxs.map((ci) => {
                  const col = cols[ci];
                  return (
                    <div
                      key={ci}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 9.5,
                          color: T.text3,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                          flexShrink: 0,
                        }}
                      >
                        {col.label}
                      </span>
                      <span
                        style={{
                          fontFamily: col.mono === false ? T.fontSans : T.fontMono,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                        }}
                      >
                        {renderCell
                          ? renderCell(row[ci], ci, ri, col)
                          : (row[ci] as unknown as ReactNode)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {footerIdxs.map((ci) => {
              const col = cols[ci];
              const hasLabel = col.label !== "";
              return (
                <div
                  key={ci}
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: `1px solid ${T.outlineFaint}`,
                    minWidth: 0,
                  }}
                >
                  {hasLabel && (
                    <div
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: 9.5,
                        color: T.text3,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                        marginBottom: 4,
                      }}
                    >
                      {col.label}
                    </div>
                  )}
                  <div
                    style={{
                      fontFamily: col.mono === false ? T.fontSans : T.fontMono,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 0,
                    }}
                  >
                    {renderCell
                      ? renderCell(row[ci], ci, ri, col)
                      : (row[ci] as unknown as ReactNode)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function Kicker({
  children,
  color,
  info,
}: {
  children: ReactNode;
  color?: string;
  info?: string;
}) {
  const T = useT();
  return (
    <div
      style={{
        fontFamily: T.fontMono,
        fontSize: 10.5,
        color: color || T.text3,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ width: 14, height: 1, background: color || T.outline }} />
      {children}
      {info && <InfoTooltip text={info} />}
    </div>
  );
}

// "i" in a circle, 14px hit target. Hovering or focusing shows a description
// tooltip positioned below the icon. Touch users tap (focus fires on tap for
// the focusable wrapper) to reveal the same popover. Native `title` is
// intentionally not set here — the styled popover *is* the tooltip; setting
// `title` would render the browser's own tooltip on top of it (double box).
export function InfoTooltip({ text, label }: { text: string; label?: string }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  return (
    <span
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      <span
        role="img"
        aria-label={label ? `${label}: ${text}` : text}
        tabIndex={0}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: 7,
          color: T.text3,
          cursor: "help",
          outline: "none",
          textTransform: "none",
          transition: "color 140ms",
        }}
      >
        {Icon.info}
      </span>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            width: 240,
            padding: "8px 10px",
            background: T.surface3,
            color: T.text2,
            borderRadius: 6,
            boxShadow: `0 0 0 1px ${T.outlineVariant}, 0 8px 24px -8px rgba(0,0,0,0.5)`,
            fontFamily: T.fontSans,
            fontSize: 11.5,
            lineHeight: 1.45,
            letterSpacing: 0,
            textTransform: "none",
            whiteSpace: "normal",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function SoftPanel({
  children,
  tint,
  style,
}: {
  children: ReactNode;
  tint?: string;
  style?: CSSProperties;
}) {
  const T = useT();
  return (
    <div
      style={{
        background: T.surface2,
        borderRadius: 10,
        boxShadow: `0 1px 0 ${T.outlineFaint}, 0 0 0 1px ${T.outlineFaint}, 0 10px 40px -20px rgba(0,0,0,0.6)`,
        borderLeft: tint ? `2px solid ${tint}` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Connector({
  d,
  color,
  dashed,
  width = 1.5,
  T,
}: {
  d: string;
  color?: string;
  dashed?: boolean;
  width?: number;
  T: Tokens;
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color || T.primary}
      strokeOpacity={0.55}
      strokeWidth={width}
      strokeDasharray={dashed ? "4 4" : undefined}
      strokeLinecap="round"
    />
  );
}

export function Pin({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 8,
        height: 8,
        borderRadius: 4,
        background: color,
        boxShadow: `0 0 0 3px ${color}22`,
      }}
    />
  );
}

export function GateGlyph({ logic, size = 28, color }: { logic: string; size?: number; color?: string }) {
  const T = useT();
  return (
    <span
      style={{
        fontFamily: T.fontHead,
        fontStyle: "italic",
        fontWeight: 600,
        fontSize: size,
        color: color || T.primaryLight,
        letterSpacing: -0.5,
        userSelect: "none",
        lineHeight: 1,
        display: "inline-block",
      }}
    >
      {logic}
    </span>
  );
}

export function Ribbon({
  kicker,
  color,
  right,
}: {
  kicker: ReactNode;
  color?: string;
  right?: ReactNode;
}) {
  const T = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 10.5,
          color: color || T.text3,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {kicker}
      </span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: (color || T.outlineVariant) + "66",
        }}
      />
      {right}
    </div>
  );
}

/* ────────── Combobox (autocomplete with free-text fallback) ──────────

   Permissive autocomplete with two-state separation:

   - `value` (controlled by parent) is the committed selection. It's what the
     parent reads on submit and what the input displays when the user isn't
     actively filtering.
   - `query` (internal) is the transient filter — what the user is currently
     typing. Filtering uses `query`, so opening the dropdown on a populated
     field shows the full menu instead of "things that look like the current
     value." This separation is what every mature combobox library (Headless
     UI, cmdk, react-select) uses; the previous single-state approach caused
     a select-RSI-then-only-RSI-shows-up bug.

   Freeform input is preserved: every keystroke still calls `onChange(query)`
   so callers like the portfolio symbol picker keep working when the user
   types a value that isn't in the list and clicks "Add".

   A chevron button toggles the dropdown explicitly so the affordance is
   visible — no need to know that focusing the input opens the menu.
*/

export interface ComboOption {
  value: string;
  label: string;
  /** Extra strings the option should match against (e.g. company name). */
  keywords?: string;
  /** Right-aligned dim text rendered next to the label in the dropdown. */
  hint?: string;
}

export function Combobox({
  label,
  info,
  value,
  onChange,
  options,
  placeholder,
  transform,
  mono,
  maxResults = 8,
  emptyHint,
}: {
  label: string;
  /** Optional tooltip body — renders an "i" icon next to the label. */
  info?: string;
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  transform?: (v: string) => string;
  mono?: boolean;
  /** Cap on filtered results when the user is actively typing. Browsing
      the full menu (no query) is uncapped — the dropdown's `overflowY:auto`
      handles scrolling for long lists like the ~824 PSX symbol universe. */
  maxResults?: number;
  emptyHint?: string;
}) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // null = not actively filtering (display `value`, show all options).
  // string = user is typing (display query, filter by it).
  const [query, setQuery] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayValue = query ?? value;

  const matches = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    // Browsing the full menu: return every option and rely on the
    // dropdown's max-height + overflowY for scrolling. Capping here would
    // hide indicators / symbols the user can't reach by scrolling.
    if (!q) return options;
    const starts: ComboOption[] = [];
    const contains: ComboOption[] = [];
    for (const opt of options) {
      const lab = opt.label.toLowerCase();
      const kw = (opt.keywords ?? "").toLowerCase();
      if (lab.startsWith(q)) starts.push(opt);
      else if (lab.includes(q) || kw.includes(q)) contains.push(opt);
      if (starts.length >= maxResults) break;
    }
    return [...starts, ...contains].slice(0, maxResults);
  }, [query, options, maxResults]);

  // Keep highlight in range when matches change.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  // Close on outside click. Listener attaches only when open.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function openDropdown() {
    setOpen(true);
    setHighlight(0);
    // Reset query so the full option list is visible. The committed value
    // still shows in the input until the user starts typing.
    setQuery(null);
  }

  function commit(opt: ComboOption) {
    onChange(transform ? transform(opt.value) : opt.value);
    setQuery(null);
    setOpen(false);
  }

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openDropdown();
      else setHighlight((h) => (matches.length === 0 ? 0 : (h + 1) % matches.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (matches.length === 0 ? 0 : (h - 1 + matches.length) % matches.length));
    } else if (e.key === "Enter" && open && matches[highlight]) {
      e.preventDefault();
      commit(matches[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(null);
    } else if (e.key === "Tab" && open && matches[highlight]) {
      // Tab acts as accept-and-move-on so power users can chain fields fast.
      commit(matches[highlight]);
    }
  }

  const showDropdown =
    open && (matches.length > 0 || ((query ?? "").length > 0 && emptyHint));

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <Kicker info={info}>{label}</Kicker>
      <div
        style={{
          marginTop: 6,
          padding: "8px 12px",
          background: T.surface,
          borderRadius: 8,
          boxShadow: `0 0 0 1px ${T.outlineFaint}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={(e) => {
            const next = transform ? transform(e.target.value) : e.target.value;
            // Track query for filtering AND propagate to parent on every
            // keystroke so freeform-submit consumers (portfolio symbol/strategy
            // pickers) keep their existing "submit as typed" behavior.
            setQuery(next);
            onChange(next);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            openDropdown();
            // Select-all so the next keystroke replaces the committed value
            // instead of appending to it. Defer to next frame because Safari
            // collapses selection on focus.
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onKeyDown={onKey}
          style={{
            background: "transparent",
            border: "none",
            color: T.text,
            fontFamily: mono ? T.fontMono : T.fontSans,
            fontSize: 13,
            width: "100%",
            padding: 0,
            outline: "none",
          }}
        />
        <button
          type="button"
          aria-label={open ? "Close options" : "Open options"}
          tabIndex={-1}
          onMouseDown={(e) => {
            // Prevent the input losing focus when clicking the chevron.
            e.preventDefault();
            if (open) {
              setOpen(false);
              setQuery(null);
            } else {
              openDropdown();
              inputRef.current?.focus();
            }
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            color: T.text3,
            cursor: "pointer",
            transform: open ? "rotate(-90deg)" : "rotate(90deg)",
            transition: "transform 120ms ease",
            lineHeight: 0,
          }}
        >
          {Icon.chev}
        </button>
      </div>
      {showDropdown && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: T.surface2,
            borderRadius: 8,
            boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 12px 32px -12px rgba(0,0,0,0.5)`,
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 10,
          }}
        >
          {matches.length === 0 && emptyHint ? (
            <div
              style={{
                padding: "10px 12px",
                fontFamily: T.fontMono,
                fontSize: 11,
                color: T.text3,
              }}
            >
              {emptyHint}
            </div>
          ) : (
            matches.map((opt, i) => {
              const active = i === highlight;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(opt);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    background: active ? T.surface3 : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono ? T.fontMono : T.fontSans,
                      fontSize: 13,
                      color: T.text,
                    }}
                  >
                    {opt.label}
                  </span>
                  {opt.hint && (
                    <span
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: 10.5,
                        color: T.text3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "60%",
                      }}
                    >
                      {opt.hint}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ────────── Flash toast ────────── */

// Hook owns the message + auto-dismiss timer. Returns the tuple that every
// page used to wire by hand (6× byte-identical copies before extraction).
export function useFlash(timeoutMs = 2600): {
  flash: string | null;
  setFlash: (msg: string | null) => void;
} {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), timeoutMs);
    return () => clearTimeout(t);
  }, [flash, timeoutMs]);
  return { flash, setFlash };
}

export function FlashToast({ message }: { message: string }) {
  const T = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
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
      <span style={{ color: T.gain }}>✓</span>
      {message}
    </div>
  );
}

/* ────────── Modal primitive ────────── */

// Body scroll lock + Escape-to-close + focus restoration. Focus trap uses the
// native browser tab order inside the dialog — simpler than a keyed cycle and
// sufficient given every modal's first interactive is an input or primary
// action.
export function useModal({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);
}

export function Modal({
  children,
  onClose,
  width = 560,
  labelledBy,
  label,
  fullHeight,
}: {
  children: ReactNode;
  onClose: () => void;
  width?: number;
  labelledBy?: string;
  label?: string;
  // For modals that manage their own inner scroll regions (e.g. a logs feed)
  fullHeight?: boolean;
}) {
  const T = useT();
  const { isMobile } = useBreakpoint();
  useModal({ onClose });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: isMobile ? 20 : 80,
        paddingLeft: isMobile ? 12 : 16,
        paddingRight: isMobile ? 12 : 16,
        paddingBottom: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: width,
          background: T.surface2,
          borderRadius: 14,
          boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 30px 80px -20px rgba(0,0,0,0.7)`,
          maxHeight: isMobile ? "none" : "calc(100dvh - 120px)",
          display: fullHeight ? "flex" : undefined,
          flexDirection: fullHeight ? "column" : undefined,
          overflow: fullHeight ? "hidden" : "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

