"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppFrame } from "@/components/frame";
import { useT } from "@/components/theme";
import {
  Btn,
  Combobox,
  Connector,
  GateGlyph,
  Kicker,
  Modal,
  Pin,
  Ribbon,
  StatusDot,
  type ComboOption,
} from "@/components/atoms";
import {
  EMPTY_UNIVERSE_AND_RISK,
  UniverseAndRiskFields,
  validateUniverseSelection,
  type UniverseAndRiskValue,
} from "@/components/universe-and-risk-fields";
import { RiskDefaultsNode } from "@/components/strategy-editor/risk-defaults-node";
import { StatusStrip } from "@/components/strategy-editor/status-strip";
import {
  InheritanceWarningModal,
  type InheritanceWarningModalSubmit,
} from "@/components/strategy-editor/inheritance-warning-modal";
import { getAllStocks, type StockResponse } from "@/lib/api/stocks";
import { Icon } from "@/components/icons";
import { useBreakpoint, PAD, pick, clampPx } from "@/components/responsive";
import type {
  ConditionLogic,
  ConditionValue,
  DefaultRisk,
  ExitRules,
  IndicatorMeta,
  InheritanceWarning,
  Operator,
  SingleCondition,
  StrategyResponse,
  StrategyUpdateBody,
  StrategyUpdateResponse,
  StrategyDependentBot,
  StrategyDependentsResponse,
  Timeframe,
} from "@/lib/api/strategies";
import {
  expressionToSource,
  hasIndicatorRef,
  tryParseExpression,
  tryParseEntryExpression,
} from "@/lib/strategy/expression";
import { ExpressionInput } from "@/components/strategy-editor/expression/expression-input";
import {
  type CondId,
  type ConditionGroup,
  type ConditionLeaf,
  type ConditionNode,
  countEmptyGroups,
  emptyGroup,
  fromBackend,
  hasAnyLeaf,
  insertChild,
  leafFromCond,
  findNode,
  findParent,
  removeNode,
  replaceNode,
  setGroupLogic,
  toBackend,
  ungroupAt,
} from "@/lib/strategy/tree";
import {
  ADD_SLOT_H,
  GATE_H,
  GATE_W,
  GROUP_LABEL_H,
  GROUP_PAD,
  type GroupLayout,
  type InsertionSlot,
  type LeafLayout,
  type NodeLayout,
  collectSlots,
  layoutBounds,
  layoutTree,
  mirrorLayout,
  shiftLayoutY,
  walkGroups,
  walkLeaves,
} from "@/lib/strategy/layout";

type SelKind = "condition" | "group";
// Phase 4b — selection is now scoped to the tree it belongs to (`entry`
// or `exit`). Leaf/group IDs are unique within a single tree but the two
// trees are independent state slices, so source disambiguates which one
// the drawer mutates. Pre-4b code that used `{kind, id}` only ever needed
// to look in the entry tree; new mutations route by `source`.
type SelSource = "entry" | "exit";
type Selection = { kind: SelKind; id: CondId; source: SelSource } | null;

type NodeKind = "momentum" | "trend" | "volume";

type CondMeta = {
  indicator: string;
  op: string;
  val: string;
  valIsRef?: boolean;
  meta: string;
  kind: NodeKind;
  compact?: boolean;
};

// SingleCondition → display tuple. The canvas/drawer originally consumed a
// hand-written CondMeta; this adapter keeps the visual layer untouched
// while the editor switches to the live SingleCondition shape returned by
// the backend. Phase 2 will let the drawer mutate the SingleCondition
// directly — for Phase 1 it's read-only.
function condToMeta(cond: SingleCondition): CondMeta {
  return {
    indicator: formatIndicator(cond.indicator, cond.params ?? null),
    op: formatOp(cond.operator),
    val: formatValue(cond.value, cond.value_source),
    // Phase SB1: expression may contain at least one live series. The visual
    // cue ("compares against a live indicator") still maps to the same case.
    valIsRef: hasIndicatorRef(cond.value),
    meta: "condition",
    kind: classifyIndicator(cond.indicator),
  };
}

function formatIndicator(ind: string, params: Record<string, number> | null): string {
  const lower = ind.toLowerCase();
  if (lower === "close_price" || lower === "close") return "Close";
  if (lower === "open_price" || lower === "open") return "Open";
  if (lower === "high_price" || lower === "high") return "High";
  if (lower === "low_price" || lower === "low") return "Low";
  if (lower === "volume") return "Volume";
  const periodMatch = lower.match(/^(sma|ema)_(\d+)$/);
  if (periodMatch) return `${periodMatch[1].toUpperCase()} (${periodMatch[2]})`;
  if (lower === "rsi") return `RSI (${params?.period ?? 14})`;
  if (lower === "macd") return "MACD";
  if (lower === "macd_signal") return "MACD Signal";
  if (lower === "macd_histogram") return "MACD Histogram";
  if (lower.startsWith("bb_")) {
    return `BB ${lower.slice(3).replace(/_/g, " ").toUpperCase()}`;
  }
  if (lower === "vwap") return "VWAP";
  if (lower === "obv") return "OBV";
  if (lower === "cmf") return "CMF";
  if (lower === "atr") return "ATR";
  if (lower === "atr_percent") return "ATR %";
  if (lower === "adx") return "ADX";
  if (lower === "roc") return "ROC";
  if (lower === "williams_r") return "Williams %R";
  if (lower === "stochastic_k") return "Stoch %K";
  if (lower === "stochastic_d") return "Stoch %D";
  if (lower === "parabolic_sar") return "Parabolic SAR";
  if (lower === "dayofweek") return "Day of week";
  if (lower === "entries_today") return "Entries today";
  if (lower === "bars_since_entry") return "Bars since last entry";
  return ind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatOp(op: Operator): string {
  if (op === "crosses_above") return "×↑";
  if (op === "crosses_below") return "×↓";
  return op;
}

function formatValue(value: ConditionValue, source?: string | null): string {
  // SB1: prefer the user-authored source text (migration 058 backfilled it for
  // legacy rows). The AST round-trip via `expressionToSource` is a safety
  // fallback for any pre-migration / malformed shape that slips through.
  if (source && source.trim()) return source;
  // Leaf-level rendering keeps the long-form indicator label so simple
  // conditions still read like "RSI < 30" instead of "rsi < 30".
  if (value.type === "constant") return String(value.value);
  if (value.type === "indicator") return formatIndicator(value.indicator, null);
  return expressionToSource(value);
}

// Phase E: build a plain-English expression from a tree node, used by the
// UngroupConfirmModal to show BEFORE / AFTER previews. Parens are emitted
// only when a sub-group's logic differs from its parent's — that's exactly
// the semantic-shift case the modal warns about, and matches how a reader
// would naturally write the expression.
function describeCondition(c: SingleCondition): string {
  return `${formatIndicator(c.indicator, c.params ?? null)} ${formatOp(c.operator)} ${formatValue(c.value, c.value_source)}`;
}

function describeNode(node: ConditionNode, parentLogic: ConditionLogic): string {
  if (node.kind === "condition") return describeCondition(node.cond);
  if (node.children.length === 0) return "(empty group)";
  if (node.children.length === 1) return describeNode(node.children[0], parentLogic);
  const sep = node.logic === "AND" ? " AND " : " OR ";
  const inner = node.children.map((c) => describeNode(c, node.logic)).join(sep);
  return parentLogic === node.logic ? inner : `(${inner})`;
}

function describeRoot(root: ConditionGroup): string {
  if (root.children.length === 0) return "(empty)";
  if (root.children.length === 1) return describeNode(root.children[0], root.logic);
  const sep = root.logic === "AND" ? " AND " : " OR ";
  return root.children.map((c) => describeNode(c, root.logic)).join(sep);
}

function classifyIndicator(ind: string): NodeKind {
  const lower = ind.toLowerCase();
  if (lower === "volume" || lower === "obv" || lower === "cmf") return "volume";
  if (
    lower.startsWith("sma_") ||
    lower.startsWith("ema_") ||
    lower.startsWith("bb_") ||
    lower === "vwap" ||
    lower === "parabolic_sar" ||
    lower === "adx" ||
    lower.endsWith("_price") ||
    lower === "close" ||
    lower === "open" ||
    lower === "high" ||
    lower === "low"
  ) {
    return "trend";
  }
  return "momentum";
}

type SaveStatus = "idle" | "saving" | "error";

// Pure serializer — kept module-level so it's straightforward to unit test
// in isolation. Everything that can be edited in the canvas/drawers travels
// through here on its way to the backend.
//
// Post-Phase B: the entry tree is the canonical state. `toBackend` strips
// client-side IDs and emits the recursive wire shape required by the
// post-Phase-A backend (see STRATEGY_TREE_PLAN.md). Exit conditions aren't
// edited as a tree in the editor — `normalizeWireGroup` re-emits them with
// `kind` discriminators in case the strategy was authored before Phase A.
//
// B046: position_sizing / risk / universe no longer round-trip through this
// shape. They live on the bot row, the backtest request, or the deploy
// request. Anything the editor used to send for those concerns has been
// dropped.
//
// Hybrid exits (Option C, 2026-05-07): `default_risk` is back on the strategy
// — strategy-level scalar guardrail defaults that bots/backtests inherit when
// their own field is null. Authored on the canvas via RiskDefaultsNode (Phase
// 4). Sent on every save; an empty `riskDefaults` object clears all four
// defaults. See `docs/EXITS_IMPLEMENTATION_PLAN.md`.
//
// Phase 4b (2026-05-07): the signal-based exit tree is now first-class
// editor state (`exitTree`). On save we re-serialize it via `toBackend` when
// it has any leaves; an empty exit tree wires `conditions: null` so the
// backend sees "no signal-based exits configured" rather than a structurally
// empty group (which would always evaluate to True and exit on every bar).
// Other `exit_rules` fields (e.g. metadata blobs) pass through `exit`.
export function buildUpdateBody(
  name: string,
  tree: ConditionGroup,
  exit: ExitRules,
  exitTree: ConditionGroup,
  riskDefaults: DefaultRisk,
): StrategyUpdateBody {
  return {
    name,
    entry_rules: { conditions: toBackend(tree) },
    exit_rules: {
      ...exit,
      conditions: hasAnyLeaf(exitTree) ? toBackend(exitTree) : null,
      default_risk: riskDefaults,
    },
  };
}

// Phase D: detects "no hover, coarse pointer" environments (mobile / tablet
// touch) so inline `+` slots can render at full opacity instead of hiding
// behind a hover-reveal that touch users can't trigger. Falls back to
// pointer/hover-aware behavior on desktop.
function useTouchPointer(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    setTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return touch;
}

export function EditorView({
  initialStrategy,
  indicatorMeta,
}: {
  initialStrategy: StrategyResponse;
  indicatorMeta: IndicatorMeta;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const [deployed, setDeployed] = useState(initialStrategy.status === "ACTIVE");
  const [savedAt, setSavedAt] = useState<number>(() => {
    if (initialStrategy.updated_at) {
      const t = new Date(initialStrategy.updated_at).getTime();
      if (!Number.isNaN(t)) return t;
    }
    return Date.now();
  });
  const [flash, setFlash] = useState<string | null>(null);

  // Lifted graph state. Post-Phase B the canvas reads off a single recursive
  // `tree`, hydrated once from `initialStrategy` with stable client-side IDs
  // attached. The Phase B canvas still flattens leaves left-to-right; Phase C
  // is the boxed-group visual rewrite. IDs never round-trip — `toBackend`
  // strips them on the way out.
  const [tree, setTree] = useState<ConditionGroup>(() =>
    fromBackend(initialStrategy.entry_rules.conditions),
  );
  // Post-B046 the editor stopped mutating exit guardrails / sizing. Hybrid
  // exits (Option C, 2026-05-07) reintroduce the four scalar guardrails as
  // strategy-level defaults under `exit_rules.default_risk`, authored on the
  // canvas via the `RiskDefaultsNode` pin.
  //
  // Phase 4b (2026-05-07): `exit_rules.conditions` (signal-based exits) is now
  // edited as a real tree (`exitTree`) on the right side of the canvas, mirror
  // of the entry tree. `exit` retains any non-conditions / non-default_risk
  // metadata so save can pass it through unchanged. `setExit` is unused today
  // (no UI mutates the metadata) but the slot is here so a future field can
  // land without a state refactor.
  const [exit] = useState<ExitRules>(initialStrategy.exit_rules ?? {});
  const [exitTree, setExitTree] = useState<ConditionGroup>(() =>
    fromBackend(
      initialStrategy.exit_rules?.conditions ?? {
        kind: "group",
        logic: "AND",
        conditions: [],
      },
    ),
  );
  const [riskDefaults, setRiskDefaults] = useState<DefaultRisk>(
    initialStrategy.exit_rules?.default_risk ?? {},
  );
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [name, setName] = useState<string>(initialStrategy.name);
  // Cached dependent-bot count, refreshed on demand. Used by both the save
  // impact warning (F8) and the delete-confirmation modal (F7).
  const [dependentsCache, setDependentsCache] =
    useState<StrategyDependentsResponse | null>(null);
  // null  = no dialog open
  // "save"   = pre-save impact warning (F8)
  // "delete" = delete-confirmation modal (F7)
  const [confirmModal, setConfirmModal] = useState<null | "save" | "delete">(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Phase E: confirmation state for group-level ops. `kind: "ungroup"` fires
  // the BEFORE/AFTER modal when the inner group's logic differs from the
  // parent's; `kind: "delete-group"` fires for groups with 2+ children. Both
  // fall through to a direct mutation when no confirmation is needed.
  const [groupModal, setGroupModal] = useState<
    | { kind: "ungroup"; groupId: CondId; source: SelSource }
    | { kind: "delete-group"; groupId: CondId; source: SelSource }
    | null
  >(null);
  // B047 deploy modal — universe picker + Confirm. `null` = closed.
  const [deployModal, setDeployModal] = useState<{
    value: UniverseAndRiskValue;
    busy: boolean;
  } | null>(null);
  // PSX universe loaded once on demand (first deploy modal open) so the
  // typical editing session doesn't pay for the /stocks fetch.
  const [stocks, setStocks] = useState<StockResponse[]>([]);
  // Phase 6 — per-bot inheritance picker. `warning` is the response slice
  // from the most recent PUT; `oldDefaultRisk` is the pre-save snapshot the
  // apply call needs (the strategy now carries the new value, the old value
  // lives only in this object). `busy` covers the apply round-trip and
  // `error` surfaces a backend rejection in the modal without dismissing it.
  const [inheritanceModal, setInheritanceModal] = useState<{
    warning: InheritanceWarning;
    oldDefaultRisk: DefaultRisk | null;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const router = useRouter();

  async function fetchDependents(): Promise<StrategyDependentsResponse | null> {
    try {
      const res = await fetch(`/api/strategies/${initialStrategy.id}/bots`);
      if (!res.ok) return null;
      const data = (await res.json()) as StrategyDependentsResponse;
      setDependentsCache(data);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  // Phase 4b — selection scoped per tree. Same id can theoretically exist in
  // both trees (UUIDs make this astronomically unlikely, but the source field
  // makes the intent explicit), so toggle-off only fires when kind+id+source
  // all match.
  const onSelect = (kind: SelKind, id: string, source: SelSource = "entry") =>
    setSelection((prev) =>
      prev?.kind === kind && prev.id === id && prev.source === source
        ? null
        : { kind, id, source }
    );
  const close = () => setSelection(null);

  // Phase 4b — pick the right state setter for source-routed mutations.
  // Returns a tuple [tree, setTree] so callers can read+update without
  // duplicating the conditional in every handler.
  const treeFor = (
    source: SelSource,
  ): [ConditionGroup, React.Dispatch<React.SetStateAction<ConditionGroup>>] =>
    source === "exit" ? [exitTree, setExitTree] : [tree, setTree];

  // Risk-defaults change handler. Wraps setRiskDefaults + setDirty so the
  // save toolbar lights up the moment the user types, and Phase 5 forms see
  // the updated default the next time they fetch the strategy. The PUT body
  // built by `buildUpdateBody` always sends the full `default_risk` object
  // (nulls included), so blanking a field reaches the backend cleanly.
  const handleRiskDefaultsChange = (next: DefaultRisk) => {
    setRiskDefaults(next);
    setDirty(true);
  };

  // Performs the actual PUT. Split out so the impact-warning modal can call
  // it directly after confirmation, bypassing the pre-flight check.
  // `silent: true` is used by autosave to skip the success flash (otherwise
  // the toast fires on every keystroke burst); error flashes still surface.
  const performSave = async (opts?: { silent?: boolean }) => {
    if (!dirty || saveStatus === "saving") return;
    // Phase D / Gap 20: tree-aware leaf check. The corner pill is gone, so
    // a strategy can be authored entirely through inline `+` and end up
    // structurally valid (groups present) but semantically empty (no leaf
    // anywhere). Block the save before it reaches the backend, which
    // rejects it independently with a 422.
    if (!hasAnyLeaf(tree)) {
      if (!opts?.silent) setFlash("A strategy needs at least one condition");
      return;
    }
    const body = buildUpdateBody(name, tree, exit, exitTree, riskDefaults);
    // Phase 6 — capture the strategy's *previous* default-risk before the
    // PUT lands so we can hand the snapshot value to apply-default-risk.
    // The backend response carries the new value on the strategy and the
    // old value only inside `inheritance_warnings.old_values`, but old_values
    // is sliced to changed fields — for the request we want the full old
    // default so future re-edits during the same modal interaction stay
    // referentially clean. Reads off `initialStrategy` (server-rendered) on
    // the first save and off the in-memory state thereafter; for autosave
    // the order is irrelevant since `riskDefaults` is the new value, not
    // the old one. This is just the saved-state snapshot at PUT time.
    const oldDefaultRisk: DefaultRisk | null =
      (initialStrategy.exit_rules?.default_risk ?? null) as DefaultRisk | null;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/strategies/${initialStrategy.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Proxy returns `{error: "<message>"}` on non-2xx (see
        // app/api/strategies/[id]/route.ts). Parse the JSON envelope so the
        // toast shows the human message (e.g. the 409 on duplicate names)
        // instead of dumping the raw `{"error":"..."}` text at the user.
        const text = await res.text().catch(() => "");
        let message = `Save failed (${res.status})`;
        if (text) {
          try {
            const data = JSON.parse(text);
            if (data && typeof data.error === "string") message = data.error;
            else message = text;
          } catch {
            message = text;
          }
        }
        throw new Error(message);
      }
      // Parse the success response so we can detect Phase 6 inheritance
      // warnings. `StrategyUpdateResponse.inheritance_warnings` is optional
      // — present iff default_risk changed AND at least one non-stopped bot
      // inherits a changed field. We tolerate parse failures (treat as
      // "no warnings" rather than blocking the save flow).
      let parsed: StrategyUpdateResponse | null = null;
      try {
        parsed = (await res.json()) as StrategyUpdateResponse;
      } catch {
        parsed = null;
      }
      setSavedAt(Date.now());
      setDirty(false);
      setSaveStatus("idle");
      // Open the per-bot picker modal when the backend reports affected
      // bots. Suppress for autosave (`silent`) — the user wasn't watching
      // for a save event, popping a modal under them is jarring.
      if (
        !opts?.silent &&
        parsed?.inheritance_warnings &&
        parsed.inheritance_warnings.affected_bots.length > 0
      ) {
        setInheritanceModal({
          warning: parsed.inheritance_warnings,
          oldDefaultRisk,
          busy: false,
          error: null,
        });
        // Don't fire the "Draft saved" toast — the modal is the user's
        // primary feedback. They'll see a confirmation toast when they
        // resolve it.
        return;
      }
      if (!opts?.silent) {
        // Phase E / E3: empty groups are allowed but surface a soft warning so
        // the author knows they evaluate to True (matches backend semantics).
        const empties = countEmptyGroups(tree);
        if (empties > 0) {
          setFlash(
            `Draft saved · ${empties} empty group${empties === 1 ? "" : "s"} will always evaluate to true`,
          );
        } else {
          setFlash("Draft saved");
        }
      }
    } catch (err) {
      setSaveStatus("error");
      setFlash(err instanceof Error ? err.message : "Save failed");
    }
  };

  // Phase 6 — submit the user's per-bot picks to the apply-default-risk
  // endpoint. The strategy edit has already committed; this round-trip
  // resolves the open question of which bots inherit vs. snapshot. On
  // success we close the modal and surface a count toast; on failure we
  // keep the modal open so the user can retry without losing their picks.
  const performApplyInheritance = async (
    decision: InheritanceWarningModalSubmit,
  ) => {
    if (!inheritanceModal) return;
    setInheritanceModal((m) =>
      m ? { ...m, busy: true, error: null } : m,
    );
    try {
      const res = await fetch(
        `/api/strategies/${initialStrategy.id}/apply-default-risk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propagate_to_bot_ids: decision.propagate_to_bot_ids,
            snapshot_bot_ids: decision.snapshot_bot_ids,
            changed_fields: inheritanceModal.warning.changed_fields,
            old_default_risk: inheritanceModal.oldDefaultRisk,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = `Apply failed (${res.status})`;
        if (text) {
          try {
            const data = JSON.parse(text);
            if (data && typeof data.error === "string") message = data.error;
            else message = text;
          } catch {
            message = text;
          }
        }
        throw new Error(message);
      }
      const data = (await res.json()) as {
        propagated_count: number;
        snapshotted_count: number;
      };
      setInheritanceModal(null);
      const parts: string[] = [];
      if (data.propagated_count > 0)
        parts.push(`${data.propagated_count} inheriting`);
      if (data.snapshotted_count > 0)
        parts.push(`${data.snapshotted_count} snapshotted`);
      setFlash(
        parts.length > 0 ? `Defaults applied · ${parts.join(" · ")}` : "Defaults applied",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      setInheritanceModal((m) =>
        m ? { ...m, busy: false, error: message } : m,
      );
    }
  };

  // F8: Pre-flight check before saving — if any bots depend on this
  // strategy, surface a confirm modal so the user knows the change will
  // affect their next trades. Click-to-Save Anyway then calls performSave().
  const handleSaveDraft = async () => {
    if (!dirty || saveStatus === "saving") return;
    const deps = await fetchDependents();
    if (deps && deps.blocking > 0) {
      setConfirmModal("save");
      return;
    }
    await performSave();
  };

  // F7: Delete a strategy. Always loads the dependent-bot list first so the
  // modal can either (a) tell the user which bots to stop, or (b) confirm
  // the destructive action when none are in the way. The actual DELETE is
  // wired in the modal's confirm handler.
  const handleDelete = async () => {
    await fetchDependents();
    setConfirmModal("delete");
  };

  const performDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/strategies/${initialStrategy.id}`, {
        method: "DELETE",
      });
      if (res.status === 409) {
        // Race: a new bot was bound after we loaded the dependents. Refresh
        // the list and keep the modal open so the user sees the new state.
        await fetchDependents();
        setFlash("Cannot delete — a bot was just bound to this strategy");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed (${res.status})`);
      }
      setConfirmModal(null);
      router.push("/strategies");
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  // B047: deploy now collects a universe (sectors / explicit symbols) which
  // the signal scanner uses to decide which stocks to scan. Without a
  // universe the scanner produces zero signals — so we open a modal first
  // to make the choice explicit. Undeploy is a one-click flip.
  const handleDeploy = async () => {
    if (deployed) {
      setDeployed(false);
      try {
        const res = await fetch(
          `/api/strategies/${initialStrategy.id}/undeploy`,
          { method: "POST" },
        );
        if (!res.ok) throw new Error(`Undeploy failed (${res.status})`);
        setSavedAt(Date.now());
        setFlash("Strategy paused · signals halted");
      } catch (err) {
        setDeployed(true);
        setFlash(err instanceof Error ? err.message : "Undeploy failed");
      }
      return;
    }
    // Opening for first time — load /stocks lazily so the picker has data.
    if (stocks.length === 0) {
      void getAllStocks()
        .then((all) => {
          if (all.length === 0) {
            // The proxy returned an empty list — surface it so the
            // user sees a real error instead of "no sectors loaded".
            // Most likely cause: backend /stocks down, or a stale
            // browser bundle from before /api/stocks existed.
            console.error("[deploy] /api/stocks returned 0 stocks");
            setFlash("Couldn't load the PSX universe — try a hard refresh (Ctrl-Shift-R).");
          }
          setStocks(all);
        })
        .catch((err) => {
          console.error("[deploy] getAllStocks failed:", err);
          setFlash(
            err instanceof Error
              ? `Couldn't load PSX universe: ${err.message}. Try a hard refresh.`
              : "Couldn't load PSX universe. Try a hard refresh (Ctrl-Shift-R)."
          );
        });
    }
    setDeployModal({ value: EMPTY_UNIVERSE_AND_RISK, busy: false });
  };

  const performDeploy = async (value: UniverseAndRiskValue) => {
    setDeployModal((m) => (m ? { ...m, busy: true } : m));
    try {
      // 2026-05-11: universe_scope is required at the schema layer.
      // The modal blocks Confirm until the user picks one (see
      // DeployModal below), so by the time we land here we can rely
      // on scope being present.
      const body: Record<string, unknown> = {
        universe_scope: value.universe_scope,
      };
      if (value.stock_filters) body.stock_filters = value.stock_filters;
      if (value.stock_symbols) body.stock_symbols = value.stock_symbols;
      const res = await fetch(
        `/api/strategies/${initialStrategy.id}/deploy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = `Deploy failed (${res.status})`;
        if (text) {
          try {
            const data = JSON.parse(text);
            if (data && typeof data.error === "string") message = data.error;
            else message = text;
          } catch {
            message = text;
          }
        }
        throw new Error(message);
      }
      setDeployed(true);
      setSavedAt(Date.now());
      setDeployModal(null);
      const summary = (() => {
        if (value.universe_scope === "all_active") return "all active stocks";
        const sectors = value.stock_filters?.sectors ?? [];
        const symbols = value.stock_symbols ?? [];
        if (sectors.length > 0) {
          return sectors.length === 1 ? sectors[0] : `${sectors.length} sectors`;
        }
        if (symbols.length > 0) {
          return `${symbols.length} ticker${symbols.length === 1 ? "" : "s"}`;
        }
        return "universe captured";
      })();
      setFlash(`Strategy deployed · ${summary}`);
    } catch (err) {
      setDeployModal((m) => (m ? { ...m, busy: false } : m));
      setFlash(err instanceof Error ? err.message : "Deploy failed");
    }
  };

  const handleRestoreVersion = (label: string) => {
    setSavedAt(Date.now());
    setFlash(`Restored ${label}`);
  };

  // Create-mode wiring — clicking an inline `+` stages a draft cond and
  // remembers (parentId, index, source) so the new leaf lands exactly where
  // the user pointed. `index === undefined` falls back to "append to end",
  // which is what every legacy code path already expected. Phase 4b: source
  // tracks which tree the slot belongs to so the create handler knows where
  // to insert on apply.
  const [creating, setCreating] = useState<{
    parentId: CondId;
    index?: number;
    source: SelSource;
    cond: SingleCondition;
  } | null>(null);
  const handleAddCondition = (
    parentId: CondId,
    index?: number,
    source: SelSource = "entry",
  ) => {
    setSelection(null);
    setCreating({
      parentId,
      index,
      source,
      cond: {
        kind: "condition",
        indicator: "rsi",
        operator: "<",
        value: { type: "constant", value: 50 },
        value_source: "50",
        params: null,
      },
    });
  };

  // Phase D: inserting an empty group from the inline picker. Arms
  // `pendingPicker` so the newly-rendered empty-group slot opens its own
  // picker on first paint — the user immediately sees the
  // condition/sub-group choice for the new group, instead of being shoved
  // into the GroupDrawer (which is for editing logic/ungroup, not for
  // first-population). Selection is left untouched so the drawer stays
  // closed; the user can click the gate or group box to open it later.
  const [pendingPicker, setPendingPicker] = useState<{
    parentId: CondId;
    index: number;
    source: SelSource;
  } | null>(null);
  const handleAddGroup = (
    parentId: CondId,
    index: number,
    logic: ConditionLogic,
    source: SelSource = "entry",
  ) => {
    const fresh = emptyGroup(logic);
    const [, set] = treeFor(source);
    set((t) => insertChild(t, parentId, fresh, index));
    setPendingPicker({ parentId: fresh.id, index: 0, source });
    setDirty(true);
  };
  // Auto-clear pendingPicker once consumed so re-renders don't reopen it.
  const consumePendingPicker = (
    parentId: CondId,
    index: number,
    source: SelSource = "entry",
  ) => {
    if (
      pendingPicker &&
      pendingPicker.parentId === parentId &&
      pendingPicker.index === index &&
      pendingPicker.source === source
    ) {
      setPendingPicker(null);
    }
  };

  // Phase 4b — entry-tree leaves still hard-block save on "no leaves left"
  // (a strategy must have at least one entry condition). Exit-tree leaves
  // are optional (an empty exit tree means "no signal-based exits, rely on
  // risk defaults"), so deleting the last exit leaf is allowed.
  const handleDeleteNode = (id: CondId, source: SelSource = "entry") => {
    const [t, set] = treeFor(source);
    const next = removeNode(t, id);
    if (source === "entry" && !hasAnyLeaf(next)) {
      setFlash("A strategy needs at least one condition");
      return;
    }
    set(next);
    setDirty(true);
    close();
    setFlash(source === "exit" ? "Exit condition deleted" : "Condition deleted");
  };

  const handleDuplicateNode = (id: CondId, source: SelSource = "entry") => {
    const [t, set] = treeFor(source);
    const node = findNode(t, id);
    if (!node || node.kind !== "condition") return;
    const parent = findParent(t, id) ?? t;
    const idx = parent.children.findIndex((c) => c.id === id);
    const copy: ConditionLeaf = leafFromCond({
      ...node.cond,
      value: { ...node.cond.value },
      params: node.cond.params ? { ...node.cond.params } : null,
    });
    set(insertChild(t, parent.id, copy, idx + 1));
    setDirty(true);
    close();
    setFlash(
      source === "exit" ? "Exit condition duplicated" : "Condition duplicated",
    );
  };

  // Toggling group logic is shared between the root (clicked via gate glyph
  // when only the root has a gate) and the GroupDrawer. Both collapse to
  // `setGroupLogic` against the in-memory tree.
  const handleSetGroupLogic = (
    id: CondId,
    logic: ConditionLogic,
    source: SelSource = "entry",
  ) => {
    const [, set] = treeFor(source);
    set((t) => setGroupLogic(t, id, logic));
    setDirty(true);
  };

  // Phase E: ungroup a sub-group, splicing its children up into the parent.
  // Skipped on root (no-op). When the group's logic differs from its parent's
  // we open `<UngroupConfirmModal>` first — the BEFORE/AFTER expressions
  // change semantically, so it's worth the friction. Matching logics ungroup
  // immediately (no semantic shift).
  const performUngroup = (id: CondId, source: SelSource = "entry") => {
    const [t, set] = treeFor(source);
    const parent = findParent(t, id);
    if (!parent) return;
    set((cur) => ungroupAt(cur, id));
    if (selection?.kind === "group" && selection.id === id) {
      setSelection(null);
    }
    setGroupModal(null);
    setDirty(true);
    setFlash("Group ungrouped");
  };
  const handleUngroupGroup = (id: CondId, source: SelSource = "entry") => {
    const [t] = treeFor(source);
    if (id === t.id) return; // root can't be ungrouped
    const target = findNode(t, id);
    const parent = findParent(t, id);
    if (!target || target.kind !== "group" || !parent) return;
    if (target.logic === parent.logic) {
      performUngroup(id, source);
      return;
    }
    setGroupModal({ kind: "ungroup", groupId: id, source });
  };

  // Phase E: cascade-delete a group + all descendants. Confirmation modal
  // fires when the group has 2+ children (one-child / empty groups are
  // low-stakes). Save validation also runs — if the deletion would leave
  // the entry tree with zero leaves, we block and flash the standard
  // message. The exit tree may be emptied (no signal-based exits) without
  // blocking the save.
  const performDeleteGroup = (id: CondId, source: SelSource = "entry") => {
    const [t, set] = treeFor(source);
    if (id === t.id) return; // root can't be deleted
    const next = removeNode(t, id);
    if (source === "entry" && !hasAnyLeaf(next)) {
      setFlash("A strategy needs at least one condition");
      setGroupModal(null);
      return;
    }
    set(next);
    if (selection?.kind === "group" && selection.id === id) {
      setSelection(null);
    }
    setGroupModal(null);
    setDirty(true);
    setFlash("Group deleted");
  };
  const handleDeleteGroup = (id: CondId, source: SelSource = "entry") => {
    const [t] = treeFor(source);
    if (id === t.id) return;
    const target = findNode(t, id);
    if (!target || target.kind !== "group") return;
    if (target.children.length >= 2) {
      setGroupModal({ kind: "delete-group", groupId: id, source });
      return;
    }
    performDeleteGroup(id, source);
  };

  // Phase E / E2: pressing Delete or Backspace with a group selected opens
  // the same delete flow the drawer's button uses. Skipped while any modal
  // is open (focus is captured) and while the user is typing in an input.
  useEffect(() => {
    if (selection?.kind !== "group") return;
    if (groupModal !== null) return;
    if (confirmModal !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t as HTMLElement).isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      handleDeleteGroup(selection.id, selection.source);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // handleDeleteGroup closes over `tree`/`exitTree`/`selection` — recreated
    // each render, but the listener attaches/detaches in the same effect cycle
    // so it always reads the current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, groupModal, confirmModal, tree, exitTree]);

  // Autosave: debounce-persist edits 800ms after the last change. Bypasses
  // the dependent-bots impact modal (`handleSaveDraft`) — that modal is for
  // explicit "I'm about to commit" gestures; for routine drafting the user
  // expects changes to stick on refresh, the same way Notion/Figma behave.
  // Skipped while another save is in flight or any blocking modal is open
  // (the modals capture intent, so we shouldn't undermine them by writing
  // around them).
  useEffect(() => {
    if (!dirty) return;
    if (saveStatus === "saving") return;
    if (confirmModal !== null || groupModal !== null) return;
    const t = setTimeout(() => {
      void performSave({ silent: true });
    }, 800);
    return () => clearTimeout(t);
    // performSave reads tree/exitTree/riskDefaults/name/exit through the
    // render closure; listing them as deps reschedules the autosave on every
    // keystroke, which is exactly the debounce we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saveStatus, confirmModal, groupModal, tree, exitTree, riskDefaults, name, exit]);

  // beforeunload guard: belt-and-suspenders for the autosave window. If the
  // user refreshes or closes the tab inside the 800ms debounce (or during
  // the in-flight PUT), the browser prompts before discarding.
  useEffect(() => {
    if (!dirty && saveStatus !== "saving") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required by the legacy Chrome/Firefox API even though modern browsers
      // ignore the string and show a generic prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saveStatus]);

  const selectedLeaf: ConditionLeaf | null = (() => {
    if (selection?.kind !== "condition") return null;
    const [t] = treeFor(selection.source);
    const node = findNode(t, selection.id);
    if (!node || node.kind !== "condition") return null;
    return node;
  })();

  const selectedGroup: ConditionGroup | null = (() => {
    if (selection?.kind !== "group") return null;
    const [t] = treeFor(selection.source);
    const node = findNode(t, selection.id);
    if (!node || node.kind !== "group") return null;
    return node;
  })();

  return (
    <AppFrame route="/strategies">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Header
          name={name}
          slug={String(initialStrategy.id)}
          deployed={deployed}
          savedAt={savedAt}
          dirty={dirty}
          saveStatus={saveStatus}
          onNameChange={(next) => {
            if (next === name) return;
            setName(next);
            setDirty(true);
          }}
          onSaveDraft={handleSaveDraft}
          onRestoreVersion={handleRestoreVersion}
          onDelete={handleDelete}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            overflow: "hidden",
            position: "relative",
            minHeight: 0,
          }}
        >
          <Canvas
            tree={tree}
            exitTree={exitTree}
            selection={selection}
            onSelect={onSelect}
            drawerOpen={selection !== null || creating !== null}
            deployed={deployed}
            onDeploy={handleDeploy}
            onAddCondition={handleAddCondition}
            onAddGroup={handleAddGroup}
            pendingPicker={pendingPicker}
            consumePendingPicker={consumePendingPicker}
            strategyId={initialStrategy.id}
            riskDefaults={riskDefaults}
            onRiskDefaultsChange={handleRiskDefaultsChange}
            latestBacktest={initialStrategy.latest_backtest ?? null}
          />
          {creating && (
            <ConditionDrawer
              key="create"
              cond={creating.cond}
              displayName={
                creating.source === "exit" ? "New exit condition" : "New condition"
              }
              indicatorMeta={indicatorMeta}
              isExitRules={creating.source === "exit"}
              onApply={(nextCond) => {
                const leaf = leafFromCond(nextCond);
                const parentId = creating.parentId;
                const index = creating.index;
                const source = creating.source;
                const [, set] = treeFor(source);
                set((t) => insertChild(t, parentId, leaf, index));
                setDirty(true);
                setCreating(null);
                setFlash(
                  `Added · ${formatIndicator(nextCond.indicator, nextCond.params ?? null)}`
                );
              }}
              onClose={() => setCreating(null)}
            />
          )}
          {!creating && selection?.kind === "condition" && selectedLeaf && (
            <ConditionDrawer
              key={selection.id}
              cond={selectedLeaf.cond}
              displayName={formatIndicator(
                selectedLeaf.cond.indicator,
                selectedLeaf.cond.params ?? null
              )}
              indicatorMeta={indicatorMeta}
              isExitRules={selection.source === "exit"}
              onApply={(nextCond) => {
                const next: ConditionLeaf = {
                  kind: "condition",
                  id: selectedLeaf.id,
                  cond: { ...nextCond, kind: "condition", params: nextCond.params ?? null },
                };
                const [, set] = treeFor(selection.source);
                set((t) => replaceNode(t, selectedLeaf.id, next));
                setDirty(true);
                close();
                setFlash(
                  `Saved · ${formatIndicator(nextCond.indicator, nextCond.params ?? null)}`
                );
              }}
              onDelete={() => handleDeleteNode(selectedLeaf.id, selection.source)}
              onDuplicate={() =>
                handleDuplicateNode(selectedLeaf.id, selection.source)
              }
              onClose={close}
            />
          )}
          {selection?.kind === "group" && selectedGroup && (
            <GroupDrawer
              key={selection.id}
              group={selectedGroup}
              isRoot={
                selection.source === "exit"
                  ? selectedGroup.id === exitTree.id
                  : selectedGroup.id === tree.id
              }
              onSetLogic={(logic) =>
                handleSetGroupLogic(selectedGroup.id, logic, selection.source)
              }
              onUngroup={() =>
                handleUngroupGroup(selectedGroup.id, selection.source)
              }
              onDelete={() =>
                handleDeleteGroup(selectedGroup.id, selection.source)
              }
              onClose={close}
            />
          )}
        </div>
      </div>
      {flash && <FlashToast message={flash} />}
      {confirmModal === "save" && dependentsCache && (
        <ImpactModal
          kind="save"
          dependents={dependentsCache}
          onCancel={() => setConfirmModal(null)}
          onConfirm={async () => {
            setConfirmModal(null);
            await performSave();
          }}
        />
      )}
      {confirmModal === "delete" && (
        <ImpactModal
          kind="delete"
          dependents={dependentsCache}
          busy={deleteBusy}
          onCancel={() => setConfirmModal(null)}
          onConfirm={performDelete}
        />
      )}
      {groupModal?.kind === "ungroup" && (() => {
        const [t] = treeFor(groupModal.source);
        const target = findNode(t, groupModal.groupId);
        if (!target || target.kind !== "group") return null;
        const before = describeRoot(t);
        const after = describeRoot(ungroupAt(t, groupModal.groupId));
        return (
          <UngroupConfirmModal
            before={before}
            after={after}
            onCancel={() => setGroupModal(null)}
            onConfirm={() =>
              performUngroup(groupModal.groupId, groupModal.source)
            }
          />
        );
      })()}
      {groupModal?.kind === "delete-group" && (() => {
        const [t] = treeFor(groupModal.source);
        const target = findNode(t, groupModal.groupId);
        if (!target || target.kind !== "group") return null;
        const childCount = target.children.length;
        return (
          <DeleteGroupConfirmModal
            childCount={childCount}
            onCancel={() => setGroupModal(null)}
            onConfirm={() =>
              performDeleteGroup(groupModal.groupId, groupModal.source)
            }
          />
        );
      })()}
      {deployModal && (
        <DeployUniverseModal
          value={deployModal.value}
          onChange={(next) =>
            setDeployModal((m) => (m ? { ...m, value: next } : m))
          }
          stocks={stocks}
          busy={deployModal.busy}
          onCancel={() => setDeployModal(null)}
          onConfirm={() => performDeploy(deployModal.value)}
        />
      )}
      {inheritanceModal && (
        <InheritanceWarningModal
          warning={inheritanceModal.warning}
          busy={inheritanceModal.busy}
          error={inheritanceModal.error}
          onCancel={() => {
            // Cancelling leaves the strategy edit in place but skips the
            // propagate/snapshot decision — every affected bot keeps
            // inheriting live, so the new default flows through on the
            // next signal evaluation. Same outcome as "all inherit", but
            // the user explicitly opted out of acknowledging it.
            setInheritanceModal(null);
            setFlash("Draft saved · all bots will inherit the new defaults");
          }}
          onConfirm={performApplyInheritance}
        />
      )}
    </AppFrame>
  );
}

function ImpactModal({
  kind,
  dependents,
  busy = false,
  onCancel,
  onConfirm,
}: {
  kind: "save" | "delete";
  dependents: StrategyDependentsResponse | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const T = useT();
  const blocking = dependents?.blocking ?? 0;
  const isDelete = kind === "delete";
  // Delete is hard-blocked when bots still depend (matches backend B2 409).
  const blocked = isDelete && blocking > 0;
  const title = isDelete
    ? blocked
      ? "Stop these bots first"
      : "Delete this strategy?"
    : `${blocking} bot${blocking === 1 ? "" : "s"} use this strategy`;
  const blurb = isDelete
    ? blocked
      ? "Strategies can only be deleted once no live bots reference them. Stop or delete the bots below, then try again."
      : "This soft-deletes the strategy. Backtests are preserved but it'll disappear from your dashboard."
    : "Saving will change the rules these live bots run on their next trade. Make sure you're ready.";
  const confirmLabel = isDelete
    ? blocked
      ? null
      : busy
      ? "Deleting…"
      : "Delete"
    : "Save anyway";
  const confirmVariant = isDelete ? "danger" : "primary";

  return (
    <Modal onClose={onCancel} label={title}>
      <div style={{ padding: 24 }}>
        <div
          style={{
            fontFamily: T.fontHead,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: -0.3,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: T.text2,
            lineHeight: 1.55,
          }}
        >
          {blurb}
        </p>
        {dependents && dependents.items.length > 0 && (
          <div
            style={{
              border: `1px solid ${T.outlineFaint}`,
              borderRadius: 8,
              maxHeight: 220,
              overflowY: "auto",
              marginBottom: 18,
            }}
          >
            {dependents.items.map((b: StrategyDependentBot, i) => (
              <div
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderTop: i === 0 ? "none" : `1px solid ${T.outlineFaint}`,
                  fontFamily: T.fontMono,
                  fontSize: 12,
                }}
              >
                <Link
                  href={`/bots/${b.id}`}
                  style={{ color: T.primaryLight, textDecoration: "none", flex: 1 }}
                >
                  {b.name}
                </Link>
                <span
                  style={{
                    fontSize: 10.5,
                    letterSpacing: 0.6,
                    color:
                      b.status === "ACTIVE"
                        ? T.gain
                        : b.status === "PAUSED"
                        ? T.warning
                        : T.text3,
                  }}
                >
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" size="sm" onClick={onCancel}>
            {blocked ? "Close" : "Cancel"}
          </Btn>
          {confirmLabel && (
            <Btn
              variant={confirmVariant}
              size="sm"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {confirmLabel}
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FlashToast({ message }: { message: string }) {
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

function formatSavedLabel(savedAt: number): string {
  const ms = Date.now() - savedAt;
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "saved just now";
  if (mins === 1) return "saved 1m ago";
  if (mins < 60) return `saved ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "saved 1h ago" : `saved ${hrs}h ago`;
}

interface VersionEntry {
  id: string;
  label: string;
  when: string;
  note: string;
  current?: boolean;
}

const MOCK_VERSIONS: VersionEntry[] = [
  { id: "v4", label: "v4", when: "just now", note: "current draft", current: true },
  { id: "v3", label: "v3", when: "2d ago", note: "tightened RSI to < 30" },
  { id: "v2", label: "v2", when: "5d ago", note: "added volume confirmation" },
  { id: "v1", label: "v1", when: "12d ago", note: "initial preset from RSI Bounce" },
];

function Header({
  name,
  slug,
  deployed,
  savedAt,
  dirty,
  saveStatus,
  onNameChange,
  onSaveDraft,
  onRestoreVersion,
  onDelete,
}: {
  name: string;
  slug: string;
  deployed: boolean;
  savedAt: number;
  dirty: boolean;
  saveStatus: SaveStatus;
  onNameChange: (next: string) => void;
  onSaveDraft: () => void;
  onRestoreVersion: (label: string) => void;
  onDelete: () => void;
}) {
  const T = useT();
  const { bp, isMobile } = useBreakpoint();
  const padX = pick(bp, PAD.page);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyAnchorRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  const commitName = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      // Empty name is invalid (backend min_length=1) — revert.
      setDraftName(name);
      setEditingName(false);
      return;
    }
    onNameChange(trimmed);
    setEditingName(false);
  };

  const cancelName = () => {
    setDraftName(name);
    setEditingName(false);
  };

  useEffect(() => {
    if (!historyOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setHistoryOpen(false);
    }
    function onDoc(e: MouseEvent) {
      if (!historyAnchorRef.current) return;
      if (!historyAnchorRef.current.contains(e.target as Node)) setHistoryOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [historyOpen]);

  const savedLabel =
    saveStatus === "saving"
      ? "saving…"
      : saveStatus === "error"
      ? "save failed — retry"
      : dirty
      ? "unsaved changes"
      : formatSavedLabel(savedAt);
  const savedColor =
    saveStatus === "error"
      ? T.loss
      : saveStatus === "saving"
      ? T.warning
      : dirty
      ? T.warning
      : T.text3;
  const statusColor = deployed ? T.deploy : T.warning;
  const statusLabel = deployed ? "deployed" : "draft";
  const saveDisabled = !dirty || saveStatus === "saving";

  return (
    <div
      style={{
        padding: pick(bp, {
          mobile: `14px ${padX} 12px`,
          desktop: `20px ${padX} 16px`,
        }),
        borderBottom: `1px solid ${T.outlineFaint}`,
        display: "flex",
        alignItems: isMobile ? "stretch" : "flex-end",
        gap: isMobile ? 12 : 24,
        flexDirection: isMobile ? "column" : "row",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: T.fontMono,
            fontSize: 11,
            color: T.text3,
            letterSpacing: 0.5,
            flexWrap: "wrap",
          }}
        >
          <Link href="/strategies" style={{ color: T.primaryLight }}>
            Strategies
          </Link>
          <span style={{ color: T.text3 }}>/</span>
          <span style={{ color: T.text2 }}>{slug}</span>
          <StatusDot color={statusColor} pulse={deployed} />
          <span style={{ color: statusColor, textTransform: "uppercase", letterSpacing: 0.6 }}>
            {statusLabel}
          </span>
          <span style={{ color: savedColor }}>· {savedLabel}</span>
        </div>
        <h1
          style={{
            fontFamily: T.fontHead,
            fontSize: clampPx(22, 5, 34),
            fontWeight: 500,
            margin: "10px 0 0",
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
          }}
        >
          {editingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelName();
                }
              }}
              maxLength={120}
              aria-label="Strategy name"
              style={{
                fontFamily: "inherit",
                fontSize: "inherit",
                fontWeight: "inherit",
                letterSpacing: "inherit",
                lineHeight: "inherit",
                color: T.text,
                background: T.surfaceLow,
                border: "none",
                outline: `2px solid ${T.primary}`,
                borderRadius: 4,
                padding: "0 6px",
                margin: "0 -6px",
                minWidth: 240,
                maxWidth: "100%",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              aria-label={`Edit name (currently ${name})`}
              title="Click to rename"
              style={{
                fontFamily: "inherit",
                fontSize: "inherit",
                fontWeight: "inherit",
                letterSpacing: "inherit",
                lineHeight: "inherit",
                color: "inherit",
                background: "transparent",
                border: "none",
                padding: "0 6px",
                margin: "0 -6px",
                cursor: "text",
                textAlign: "left",
                borderRadius: 4,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = T.surfaceLow;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {name}
            </button>
          )}
        </h1>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.text3, marginRight: 4 }}>
          last backtest <span style={{ color: T.text3 }}>—</span>
        </span>
        <div ref={historyAnchorRef} style={{ position: "relative" }}>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            History
          </Btn>
          {historyOpen && (
            <HistoryPopover
              onRestore={(label) => {
                setHistoryOpen(false);
                onRestoreVersion(label);
              }}
            />
          )}
        </div>
        <Btn
          variant={saveStatus === "error" ? "primary" : "outline"}
          size="sm"
          disabled={saveDisabled}
          onClick={onSaveDraft}
        >
          {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Retry save" : "Save draft"}
        </Btn>
        <Btn variant="ghost" size="sm" onClick={onDelete}>
          Delete
        </Btn>
      </div>
    </div>
  );
}

function HistoryPopover({ onRestore }: { onRestore: (label: string) => void }) {
  const T = useT();
  return (
    <div
      aria-label="Version history"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        minWidth: 260,
        background: T.surface2,
        borderRadius: 10,
        boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 20px 60px -12px rgba(0,0,0,0.5)`,
        zIndex: 50,
        padding: 6,
      }}
    >
      <div
        style={{
          padding: "8px 10px 6px",
          fontFamily: T.fontMono,
          fontSize: 10.5,
          color: T.text3,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        Version history
      </div>
      {MOCK_VERSIONS.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => !v.current && onRestore(`${v.label} · ${v.when}`)}
          disabled={v.current}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "baseline",
            gap: 10,
            padding: "8px 10px",
            border: "none",
            borderRadius: 6,
            background: "transparent",
            textAlign: "left",
            cursor: v.current ? "default" : "pointer",
            color: T.text,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            if (!v.current) (e.currentTarget as HTMLButtonElement).style.background = T.surfaceLow;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 12,
              color: v.current ? T.primaryLight : T.text,
              minWidth: 28,
            }}
          >
            {v.label}
          </span>
          <span style={{ flex: 1, fontSize: 12, color: T.text2 }}>{v.note}</span>
          <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.text3 }}>
            {v.current ? "current" : v.when}
          </span>
        </button>
      ))}
    </div>
  );
}

function Canvas({
  tree,
  exitTree,
  selection,
  onSelect,
  drawerOpen,
  deployed,
  onDeploy,
  onAddCondition,
  onAddGroup,
  pendingPicker,
  consumePendingPicker,
  strategyId,
  riskDefaults,
  onRiskDefaultsChange,
  latestBacktest,
}: {
  tree: ConditionGroup;
  // Phase 4b — signal-based exit conditions, edited as a parallel tree
  // mirrored on the right side of the canvas.
  exitTree: ConditionGroup;
  selection: Selection;
  onSelect: (kind: SelKind, id: CondId, source?: SelSource) => void;
  drawerOpen: boolean;
  deployed: boolean;
  onDeploy: () => void;
  onAddCondition: (
    parentId: CondId,
    index?: number,
    source?: SelSource,
  ) => void;
  onAddGroup: (
    parentId: CondId,
    index: number,
    logic: ConditionLogic,
    source?: SelSource,
  ) => void;
  pendingPicker: { parentId: CondId; index: number; source: SelSource } | null;
  consumePendingPicker: (
    parentId: CondId,
    index: number,
    source?: SelSource,
  ) => void;
  strategyId: number;
  // Hybrid exits (Option C, Phase 4): the four scalar guardrails the
  // RiskDefaultsNode authors. Sent on every save via `buildUpdateBody`.
  riskDefaults: DefaultRisk;
  onRiskDefaultsChange: (next: DefaultRisk) => void;
  // Most-recent backtest summary (joined into the strategy response).
  // Drives the StatusStrip's backtest segment; null when no backtest has
  // been run yet.
  latestBacktest: {
    id: number;
    total_return_pct: number | string;
    completed_at: string;
  } | null;
}) {
  const isSelected = (kind: SelKind, id: CondId, source: SelSource) =>
    selection?.kind === kind &&
    selection.id === id &&
    selection.source === source;
  const T = useT();
  const isTouch = useTouchPointer();
  const [pan, setPan] = useState({ x: 40, y: 20 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  // Phase D: pointer position in world coords, used by inline `+` slots
  // for the proximity-reveal effect (Gap 19). Null means pointer is off
  // the canvas. Touch viewports skip this entirely (slots are always-on).
  const [pointerWorld, setPointerWorld] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchStartRef = useRef<{
    dist: number;
    zoom: number;
    midScreen: { x: number; y: number };
    midWorld: { x: number; y: number };
  } | null>(null);
  const viewRef = useRef({ pan, zoom });

  useEffect(() => {
    viewRef.current = { pan, zoom };
  }, [pan, zoom]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { pan: cp, zoom: cz } = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nz = Math.max(0.3, Math.min(2.5, cz * factor));
      const wx = (cx - cp.x) / cz;
      const wy = (cy - cp.y) / cz;
      setPan({ x: cx - wx * nz, y: cy - wy * nz });
      setZoom(nz);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const tgt = e.target as HTMLElement;
    const isBg =
      tgt === canvasRef.current ||
      tgt === worldRef.current ||
      tgt.dataset?.bg === "true";
    if (!isBg) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { pan: cp, zoom: cz } = viewRef.current;
    if (pointersRef.current.size === 1) {
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: cp.x, panY: cp.y };
      pinchStartRef.current = null;
      setIsDragging(true);
    } else if (pointersRef.current.size === 2) {
      const el = canvasRef.current;
      if (!el) return;
      const [a, b] = Array.from(pointersRef.current.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const rect = el.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      pinchStartRef.current = {
        dist,
        zoom: cz,
        midScreen: { x: mx, y: my },
        midWorld: { x: (mx - cp.x) / cz, y: (my - cp.y) / cz },
      };
      panStartRef.current = null;
    }
    e.preventDefault();
  };

  // Track pointer in world coords for the inline `+` proximity reveal.
  // Runs unconditionally (not gated on pointer-capture) so hover-only
  // movement updates slot opacities even when the user isn't dragging.
  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isTouch) return;
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const { pan: cp, zoom: cz } = viewRef.current;
    setPointerWorld({
      x: (e.clientX - rect.left - cp.x) / cz,
      y: (e.clientY - rect.top - cp.y) / cz,
    });
  };
  const onCanvasPointerLeave = () => {
    setPointerWorld(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && pinchStartRef.current) {
      const [a, b] = Array.from(pointersRef.current.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const start = pinchStartRef.current;
      if (start.dist <= 0) return;
      const scale = dist / start.dist;
      const nz = Math.max(0.3, Math.min(2.5, start.zoom * scale));
      setPan({
        x: start.midScreen.x - start.midWorld.x * nz,
        y: start.midScreen.y - start.midWorld.y * nz,
      });
      setZoom(nz);
    } else if (panStartRef.current && pointersRef.current.size === 1) {
      const start = panStartRef.current;
      setPan({
        x: start.panX + (e.clientX - start.x),
        y: start.panY + (e.clientY - start.y),
      });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.delete(e.pointerId);
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values());
      const { pan: cp } = viewRef.current;
      panStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        panX: cp.x,
        panY: cp.y,
      };
      pinchStartRef.current = null;
    } else if (pointersRef.current.size === 0) {
      panStartRef.current = null;
      pinchStartRef.current = null;
      setIsDragging(false);
    }
  };

  const bumpZoom = (factor: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const nz = Math.max(0.3, Math.min(2.5, zoom * factor));
    const wx = (cx - pan.x) / zoom;
    const wy = (cy - pan.y) / zoom;
    setPan({ x: cx - wx * nz, y: cy - wy * nz });
    setZoom(nz);
  };

  // Auto-fit on mount: run resetView once after the canvas ref is wired
  // up, so users opening an existing complex strategy don't land on a
  // mostly-empty viewport. Subsequent re-renders preserve user pan.
  const didInitialFit = useRef(false);

  // Fit the entire tree + output column into the visible canvas. Layered
  // layout means deep trees extend leftward into negative X, so the
  // pre-layered "pan = (40, 20)" default would leave deep trees mostly
  // off-screen. resetView now actually fits to content.
  //
  // Phase 4b — also fits the mirrored exit tree on the right, which can
  // extend well past the RiskDefaultsNode column. We replay the same
  // mirror-axis math the render block uses so the bounds match what's
  // actually drawn.
  const resetView = () => {
    const el = canvasRef.current;
    if (!el) {
      setPan({ x: 40, y: 20 });
      setZoom(1);
      return;
    }
    // Spine gap on each side of the Risk Defaults hub. Same value on both
    // sides so the hub sits at the geometric center; small enough that the
    // hub reads as "tied to" both trees rather than floating between them
    // (402px+402px on a 1500px canvas left a visible dead zone in the
    // middle). The bezier control-point offset (80px in pushWire) gives the
    // wire a gentle sweep at this gap.
    const SPINE_GAP = 160;
    const ROOT_TO_OUTPUT_GAP = SPINE_GAP;
    const RISK_NODE_W = RiskDefaultsNode.WIDTH;
    const RISK_TO_EXIT_GAP = SPINE_GAP;
    const rootRaw = layoutTree(tree);
    const exitRawForMirror = layoutTree(exitTree);
    const outputX = rootRaw.gateX + GATE_W + ROOT_TO_OUTPUT_GAP;
    const EXIT_ROOT_GATE_X = outputX + RISK_NODE_W + RISK_TO_EXIT_GAP;
    const mirrorAxisX = (EXIT_ROOT_GATE_X + 410 + GATE_W) / 2;
    const exitMirrored = mirrorLayout(exitRawForMirror, mirrorAxisX);
    // Y-align both root gates so the spine reads as one horizontal bar.
    const unifiedGateY = Math.max(rootRaw.gateY, exitMirrored.gateY);
    const root = shiftLayoutY(rootRaw, unifiedGateY - rootRaw.gateY);
    const exitRoot = shiftLayoutY(exitMirrored, unifiedGateY - exitMirrored.gateY);
    const bounds = layoutBounds(root);
    const exitBounds = layoutBounds(exitRoot);
    const fitMaxX = Math.max(outputX + RISK_NODE_W + 24, exitBounds.maxX) + 24;
    const fitMinX = Math.min(bounds.minX, exitBounds.minX) - 24;
    const fitMinY = Math.min(bounds.minY, exitBounds.minY) - 24;
    const fitMaxY =
      Math.max(
        bounds.maxY,
        exitBounds.maxY,
        root.addSlotCy + ADD_SLOT_H / 2,
        exitRoot.addSlotCy + ADD_SLOT_H / 2,
      ) + 24;
    const contentW = fitMaxX - fitMinX;
    const contentH = fitMaxY - fitMinY;
    const rect = el.getBoundingClientRect();
    const fitZoom = Math.min(rect.width / contentW, rect.height / contentH, 1);
    const z = Math.max(0.3, Math.min(2.5, fitZoom));
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const wx = (fitMinX + fitMaxX) / 2;
    const wy = (fitMinY + fitMaxY) / 2;
    setPan({ x: cx - wx * z, y: cy - wy * z });
    setZoom(z);
  };

  useEffect(() => {
    if (didInitialFit.current) return;
    if (!canvasRef.current) return;
    didInitialFit.current = true;
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        onCanvasPointerMove(e);
        onPointerMove(e);
      }}
      onPointerLeave={onCanvasPointerLeave}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        backgroundColor: T.surfaceLowest,
        backgroundImage: `radial-gradient(circle, ${T.surface3}80 0.8px, transparent 0.8px)`,
        backgroundSize: `${36 * zoom}px ${36 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      <div
        ref={worldRef}
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0 0",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {(() => {
          // Phase C: tree-aware auto-layout. The flat-list math from B is
          // replaced by `layoutTree` (recursive size + place) which returns
          // (x, y) for every node and per-group gate coordinates. For a
          // depth-1 tree the layout produces near-identical pixel positions
          // to the pre-Phase-C canvas; nested groups get boxed containers
          // with their own gate glyph.
          // Phase C: tree-aware auto-layout. The flat-list math from B is
          // replaced by `layoutTree` (recursive size + place) which returns
          // (x, y) for every node and per-group gate coordinates.
          //
          // Phase 4 (Option C hybrid exits, 2026-05-07): the right side used
          // to host three OutputPins; replaced by the pinned
          // `RiskDefaultsNode` — strategy-level scalar guardrail defaults.
          //
          // Phase 4b (2026-05-07): the right side now also hosts a parallel
          // mirrored exit tree. Past the RiskDefaultsNode (right edge at
          // `outputX + RISK_NODE_W`), the exit tree's mirrored layout
          // begins — its root gate sits at `EXIT_ROOT_GATE_X`, leaves flow
          // rightward via `mirrorLayout`'s X reflection.
          //
          // Phase 4b alignment fix (2026-05-08): each tree packs its own
          // children top-down so their root gateYs differ; we Y-align both
          // roots on `unifiedGateY = max(entryGateY, exitGateY)` via
          // `shiftLayoutY`, and Risk Defaults centers on that same Y. The
          // result: entry gate, Risk Defaults pin, exit gate all share one
          // horizontal spine. Risk Defaults now also gets a wire on its
          // right pin → exit root, so it reads as a junction (governs both
          // entry- and exit-driven trades) rather than a one-sided dead-end.
          // Spine gap — see resetView for rationale.
          const SPINE_GAP = 160;
          const ROOT_TO_OUTPUT_GAP = SPINE_GAP;
          const RISK_NODE_W = RiskDefaultsNode.WIDTH;
          const RISK_TO_EXIT_GAP = SPINE_GAP;
          const rootRaw = layoutTree(tree);
          const exitRawForMirror = layoutTree(exitTree);
          const outputX = rootRaw.gateX + GATE_W + ROOT_TO_OUTPUT_GAP;
          // Place the exit root gate's left edge at `EXIT_ROOT_GATE_X` (just
          // past RiskDefaultsNode + a small gap). Derive `mirrorAxisX` from
          // the original ROOT_GATE_X (=410) anchor: a mirror about
          // `mirrorAxisX` flips left edge of the root gate from
          // `ROOT_GATE_X` to `2*mirrorAxisX - ROOT_GATE_X - GATE_W`. Solve
          // `2*mirrorAxisX - ROOT_GATE_X - GATE_W = EXIT_ROOT_GATE_X` for
          // axisX. After the mirror, leaves flow rightward, gate sits on
          // the LEFT, slots position on the gate's right side.
          const EXIT_ROOT_GATE_X = outputX + RISK_NODE_W + RISK_TO_EXIT_GAP;
          const mirrorAxisX = (EXIT_ROOT_GATE_X + 410 + GATE_W) / 2;
          const exitMirrored = mirrorLayout(exitRawForMirror, mirrorAxisX);
          // Y-align: shift the smaller tree down so both root gates share
          // `unifiedGateY`. delta = 0 for the taller tree (no-op).
          const unifiedGateY = Math.max(rootRaw.gateY, exitMirrored.gateY);
          const root = shiftLayoutY(rootRaw, unifiedGateY - rootRaw.gateY);
          const exitRoot = shiftLayoutY(
            exitMirrored,
            unifiedGateY - exitMirrored.gateY,
          );

          const allLeaves = walkLeaves(root);
          const nestedGroups = walkGroups(root); // excludes root
          const slots = collectSlots(root);
          const isTreeEmpty = tree.children.length === 0;

          // Pre-built id → group lookup so the wire pass can resolve each
          // node's `parentGateId` to a target gate position in O(1).
          const groupMap = new Map<string, GroupLayout>();
          groupMap.set(root.id, root);
          for (const g of nestedGroups) groupMap.set(g.id, g);

          // Right-side anchor. `rootOriginX/Y` tracks the actual outgoing
          // pin so single-child trees still wire from the leaf without
          // going through a hidden gate.
          const rootOriginX = root.showGate ? root.gateX + GATE_W : root.pinX;
          const rootOriginY = root.showGate ? root.gateY : root.pinY;
          const outputCurveCtrlX = (rootOriginX + outputX) / 2;
          // RiskDefaultsNode coordinates. Pin Y is the unified gate Y
          // (shared spine); the node top sits PIN_OFFSET_Y above so the pin
          // lines up exactly. Left pin is `riskPinX`, right pin is
          // `riskRightPinX = outputX + RISK_NODE_W` — the Risk node now
          // bridges entry and exit trees instead of being a dead-end.
          const riskPinY = unifiedGateY;
          const riskNodeY = riskPinY - RiskDefaultsNode.PIN_OFFSET_Y;
          const riskPinX = outputX;
          const riskRightPinX = outputX + RISK_NODE_W;

          const exitOriginX = exitRoot.showGate ? exitRoot.gateX : exitRoot.pinX;
          const exitOriginY = exitRoot.showGate ? exitRoot.gateY : exitRoot.pinY;
          const exitCurveCtrlX = (riskRightPinX + exitOriginX) / 2;

          const exitLeaves = walkLeaves(exitRoot);
          const exitNestedGroups = walkGroups(exitRoot);
          const exitSlots = collectSlots(exitRoot);
          const isExitTreeEmpty = exitTree.children.length === 0;
          const exitGroupMap = new Map<string, GroupLayout>();
          exitGroupMap.set(exitRoot.id, exitRoot);
          for (const g of exitNestedGroups) exitGroupMap.set(g.id, g);

          // Each non-root group with a visible gate, plus each leaf,
          // contributes one wire to its parent gate. Groups whose own gate
          // is hidden (n=1) are intentionally skipped — the single child
          // wires straight through to the grandparent's gate.
          const wires: Array<{
            id: string;
            d: string;
            dashed: boolean;
            color?: string;
            width?: number;
          }> = [];
          const pushWire = (
            from: { x: number; y: number },
            to: { x: number; y: number },
            opts: { id: string; dashed: boolean; color?: string; width?: number },
          ) => {
            // Cubic-bezier with both control points at midX. midX is offset
            // 80px from `from` toward `to` (sign-aware), so mirrored exit
            // wires get a symmetric curve flowing leftward instead of an
            // overshoot to the right.
            const direction = Math.sign(to.x - from.x) || 1;
            const midX = from.x + 80 * direction;
            wires.push({
              id: opts.id,
              d: `M ${from.x} ${from.y} C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`,
              dashed: opts.dashed,
              color: opts.color,
              width: opts.width,
            });
          };
          // Wire endpoints are side-of-gate aware. In the entry tree gates
          // sit to the RIGHT of their children: child outputs leave from the
          // child's right edge and enter the parent gate's LEFT edge. The
          // exit tree is mirrored, so the geometry is flipped — gates sit to
          // the LEFT of their children, child outputs leave from the child's
          // LEFT edge (already true for leaves since `mirrorLayout` reflected
          // `pinX`, but NOT true for nested-group gates whose `gateX + GATE_W`
          // is now the side facing the children, not the parent), and parent
          // gates accept input on their RIGHT edge. Without this flip, wires
          // on the exit side terminate at the far side of each gate glyph and
          // slice across it. `mirrored` toggles the convention.
          const buildVisit = (
            sourceTag: SelSource,
            gMap: Map<string, GroupLayout>,
            mirrored: boolean,
          ) => {
            const groupOutputX = (g: GroupLayout) =>
              mirrored ? g.gateX : g.gateX + GATE_W;
            const groupInputX = (g: GroupLayout) =>
              mirrored ? g.gateX + GATE_W : g.gateX;
            const visit = (n: NodeLayout) => {
              if (n.kind === "condition") {
                const parent = gMap.get(n.parentGateId);
                if (parent && parent.showGate) {
                  pushWire(
                    { x: n.pinX, y: n.pinY },
                    { x: groupInputX(parent), y: parent.gateY },
                    { id: `wire-${sourceTag}-${n.id}`, dashed: true },
                  );
                }
                return;
              }
              if (n.showGate && n.parentGateId) {
                const parent = gMap.get(n.parentGateId);
                if (parent && parent.showGate) {
                  pushWire(
                    { x: groupOutputX(n), y: n.gateY },
                    { x: groupInputX(parent), y: parent.gateY },
                    {
                      id: `wire-${sourceTag}-${n.id}`,
                      dashed: false,
                      color: T.primaryLight,
                      width: 2,
                    },
                  );
                }
              }
              for (const c of n.children) visit(c);
            };
            return visit;
          };
          const visitEntry = buildVisit("entry", groupMap, false);
          for (const c of root.children) visitEntry(c);
          const visitExit = buildVisit("exit", exitGroupMap, true);
          for (const c of exitRoot.children) visitExit(c);

          return (
            <>
              <svg
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  overflow: "visible",
                }}
              >
                {wires.map((w) => (
                  <Connector
                    key={w.id}
                    d={w.d}
                    dashed={w.dashed}
                    color={w.color}
                    width={w.width}
                    T={T}
                  />
                ))}
                {/* Spine: entry root → Risk Defaults left pin, then Risk
                    Defaults right pin → exit root. After Y-alignment all
                    three points share `unifiedGateY` so the spine reads as
                    one horizontal bar. Risk Defaults bridges both trees —
                    the same scalar caps govern entry- and exit-driven
                    trades, and the dual wire makes that visible. */}
                <Connector
                  d={`M ${rootOriginX} ${rootOriginY} C ${outputCurveCtrlX} ${rootOriginY} ${outputCurveCtrlX} ${riskPinY} ${riskPinX} ${riskPinY}`}
                  color={T.primary}
                  width={1.4}
                  T={T}
                />
                <Connector
                  d={`M ${riskRightPinX} ${riskPinY} C ${exitCurveCtrlX} ${riskPinY} ${exitCurveCtrlX} ${exitOriginY} ${exitOriginX} ${exitOriginY}`}
                  color={T.primary}
                  width={1.4}
                  T={T}
                />
              </svg>

              {/* The central RiskDefaultsNode now carries the
                  ← Entry / Strategy / Exit → header inline, so the
                  free-floating pills above each root gate are dropped —
                  the hub's directional cues do the same job without
                  pulling attention away from the spine. */}

              {/* Entry tree — leaves, groups, gates, slots. */}
              {nestedGroups.map((g) => (
                <GroupBox
                  key={`box-entry-${g.id}`}
                  group={g}
                  selected={isSelected("group", g.id, "entry")}
                  onSelect={() => onSelect("group", g.id, "entry")}
                />
              ))}
              {allLeaves.map((leaf) => {
                const meta = condToMeta(leaf.node.cond);
                return (
                  <CondNode
                    key={`leaf-entry-${leaf.id}`}
                    x={leaf.x}
                    y={leaf.y}
                    {...meta}
                    selected={isSelected("condition", leaf.id, "entry")}
                    onClick={() => onSelect("condition", leaf.id, "entry")}
                  />
                );
              })}
              {root.showGate && (
                <GateButton
                  x={root.gateX}
                  y={root.gateY}
                  logic={root.node.logic}
                  selected={isSelected("group", root.id, "entry")}
                  onClick={() => onSelect("group", root.id, "entry")}
                />
              )}
              {nestedGroups.map((g) =>
                g.showGate ? (
                  <GateButton
                    key={`gate-entry-${g.id}`}
                    x={g.gateX}
                    y={g.gateY}
                    logic={g.node.logic}
                    selected={isSelected("group", g.id, "entry")}
                    onClick={() => onSelect("group", g.id, "entry")}
                  />
                ) : null,
              )}
              {slots.map((slot) => (
                <InsertSlot
                  key={`slot-entry-${slot.parentId}-${slot.index}`}
                  slot={slot}
                  isTreeEmpty={isTreeEmpty && slot.parentId === root.id}
                  autoOpen={
                    pendingPicker !== null &&
                    pendingPicker.source === "entry" &&
                    pendingPicker.parentId === slot.parentId &&
                    pendingPicker.index === slot.index
                  }
                  onAutoOpenConsumed={() =>
                    consumePendingPicker(slot.parentId, slot.index, "entry")
                  }
                  onAddCondition={() =>
                    onAddCondition(slot.parentId, slot.index, "entry")
                  }
                  onAddGroup={(logic) =>
                    onAddGroup(slot.parentId, slot.index, logic, "entry")
                  }
                />
              ))}

              {/* Exit tree — mirrored layout, same render passes. */}
              {exitNestedGroups.map((g) => (
                <GroupBox
                  key={`box-exit-${g.id}`}
                  group={g}
                  selected={isSelected("group", g.id, "exit")}
                  onSelect={() => onSelect("group", g.id, "exit")}
                />
              ))}
              {exitLeaves.map((leaf) => {
                const meta = condToMeta(leaf.node.cond);
                return (
                  <CondNode
                    key={`leaf-exit-${leaf.id}`}
                    x={leaf.x}
                    y={leaf.y}
                    {...meta}
                    selected={isSelected("condition", leaf.id, "exit")}
                    onClick={() => onSelect("condition", leaf.id, "exit")}
                  />
                );
              })}
              {exitRoot.showGate && (
                <GateButton
                  x={exitRoot.gateX}
                  y={exitRoot.gateY}
                  logic={exitRoot.node.logic}
                  selected={isSelected("group", exitRoot.id, "exit")}
                  onClick={() => onSelect("group", exitRoot.id, "exit")}
                />
              )}
              {exitNestedGroups.map((g) =>
                g.showGate ? (
                  <GateButton
                    key={`gate-exit-${g.id}`}
                    x={g.gateX}
                    y={g.gateY}
                    logic={g.node.logic}
                    selected={isSelected("group", g.id, "exit")}
                    onClick={() => onSelect("group", g.id, "exit")}
                  />
                ) : null,
              )}
              {exitSlots.map((slot) => (
                <InsertSlot
                  key={`slot-exit-${slot.parentId}-${slot.index}`}
                  slot={slot}
                  isTreeEmpty={isExitTreeEmpty && slot.parentId === exitRoot.id}
                  autoOpen={
                    pendingPicker !== null &&
                    pendingPicker.source === "exit" &&
                    pendingPicker.parentId === slot.parentId &&
                    pendingPicker.index === slot.index
                  }
                  onAutoOpenConsumed={() =>
                    consumePendingPicker(slot.parentId, slot.index, "exit")
                  }
                  onAddCondition={() =>
                    onAddCondition(slot.parentId, slot.index, "exit")
                  }
                  onAddGroup={(logic) =>
                    onAddGroup(slot.parentId, slot.index, logic, "exit")
                  }
                />
              ))}

              <RiskDefaultsNode
                x={outputX}
                y={riskNodeY}
                value={riskDefaults}
                onChange={onRiskDefaultsChange}
              />
            </>
          );
        })()}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: drawerOpen ? 412 : 24,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 6px",
          borderRadius: 999,
          background: T.surface2 + "e6",
          backdropFilter: "blur(10px)",
          border: `1px solid ${T.outlineFaint}`,
          fontFamily: T.fontMono,
          fontSize: 11,
          color: T.text3,
          zIndex: 5,
          userSelect: "none",
          transition: "right 240ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <ZoomBtn onClick={() => bumpZoom(1 / 1.2)} label="−" />
        <span
          style={{
            color: T.text2,
            padding: "0 8px",
            minWidth: 40,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <ZoomBtn onClick={() => bumpZoom(1.2)} label="+" />
        <span style={{ width: 1, height: 14, background: T.outlineFaint, margin: "0 4px" }} />
        <ZoomBtn onClick={resetView} label="fit" />
      </div>

      {/* Phase 4: StatusStrip carries the navigation role the three OutputPins
          used to (Backtest / Live signals / Automate). Sits just above the
          zoom-controls pill on the right; slides with the drawer same way. */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          right: drawerOpen ? 412 : 24,
          zIndex: 5,
          transition: "right 240ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <StatusStrip
          strategyId={strategyId}
          deployed={deployed}
          backtest={
            latestBacktest
              ? {
                  totalReturnPct: Number(latestBacktest.total_return_pct),
                  completedAt: latestBacktest.completed_at,
                }
              : null
          }
          // Bot binding lights up in Phase 6 once the picker modal is wired;
          // until then we don't surface a ghost "No bot" segment that pads
          // the strip without doing anything useful.
          botBinding={null}
        />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          padding: "6px 16px",
          background: T.surface2 + "e6",
          backdropFilter: "blur(10px)",
          borderRadius: 999,
          boxShadow: `0 10px 40px -10px rgba(0,0,0,0.6), 0 0 0 1px ${T.outlineFaint}`,
          alignItems: "center",
          zIndex: 5,
        }}
      >
        <Link href={`/backtest/new?strategy_id=${strategyId}`} style={{ textDecoration: "none" }}>
          <Btn variant="outline" size="sm">
            Run backtest
          </Btn>
        </Link>
        <Btn variant="deploy" size="sm" icon={Icon.spark} onClick={onDeploy}>
          {deployed ? "Pause" : "Deploy"}
        </Btn>
        <Link href={`/bots/new?strategy_id=${strategyId}`} style={{ textDecoration: "none" }}>
          <Btn variant="primary" size="sm" icon={Icon.bot}>
            + Bot
          </Btn>
        </Link>
      </div>
    </div>
  );
}

function ZoomBtn({ onClick, label }: { onClick: () => void; label: string }) {
  const T = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        color: T.text2,
        cursor: "pointer",
        minWidth: 28,
        minHeight: 28,
        padding: "6px 10px",
        borderRadius: 999,
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function CondNode({
  x,
  y,
  indicator,
  op,
  val,
  valIsRef,
  meta,
  kind,
  compact,
  selected,
  onClick,
}: {
  x: number;
  y: number;
  indicator: string;
  op: string;
  val: string;
  valIsRef?: boolean;
  meta: string;
  kind: "momentum" | "trend" | "volume";
  compact?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const T = useT();
  const h = compact ? 88 : 108;
  const kindColor: Record<string, string> = {
    momentum: T.primaryLight,
    trend: T.accent,
    volume: "#c7a885",
  };
  const color = kindColor[kind] || T.primaryLight;
  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 200,
        height: h,
        background: T.surfaceLow,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: onClick ? "pointer" : undefined,
        boxShadow: selected
          ? `0 0 0 2px ${T.primary}, 0 8px 28px -10px rgba(0,0,0,0.6)`
          : `0 0 0 1px ${T.outlineFaint}, 0 4px 12px -8px rgba(0,0,0,0.5)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: T.fontMono,
          fontSize: 10,
          color,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        <span style={{ width: 4, height: 4, borderRadius: 2, background: color }} />
        {meta}
      </div>
      <div
        style={{
          fontFamily: T.fontHead,
          fontSize: 15,
          fontWeight: 500,
          color: T.text,
          marginTop: 6,
          letterSpacing: -0.2,
        }}
      >
        {indicator}
      </div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 12,
          color: T.text2,
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ color: T.text3 }}>{op}</span>
        <span style={{ color: valIsRef ? T.primaryLight : T.accent }}>{val}</span>
      </div>
      <Pin x={196} y={h / 2 - 4} color={T.primary} />
    </div>
  );
}

// Boxed container for nested groups. The root group renders without a box
// (its gate sits at the same canvas position the pre-Phase-C global gate
// occupied), so this only renders for depth ≥1 nodes. Border styling is
// state-driven (default / hover / selected) and clicking the box selects
// the group — the gate glyph is its own click target but selects the same
// group (Gap 13: one selection target, two affordances).
function GroupBox({
  group,
  selected,
  onSelect,
}: {
  group: GroupLayout;
  selected: boolean;
  onSelect: () => void;
}) {
  const T = useT();
  const [hover, setHover] = useState(false);
  const border = selected
    ? `1.5px solid ${T.primaryLight}`
    : hover
      ? `1px solid ${T.outlineVariant}`
      : `1px dashed ${T.outlineFaint}`;
  const shadow = selected
    ? `0 0 0 4px ${T.primary}20`
    : undefined;
  return (
    <div
      onClick={(e) => {
        // Only trigger when the box itself is clicked, not a child node
        // bubbling up. The leaf/group children stop propagation by virtue
        // of having their own onClick handlers.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.boxLabel === "true") {
          onSelect();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: group.x,
        top: group.y,
        width: group.w,
        height: group.h,
        borderRadius: 14,
        border,
        background: T.surfaceLow + "40",
        boxShadow: shadow,
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      <div
        data-box-label="true"
        style={{
          position: "absolute",
          left: GROUP_PAD,
          top: 6,
          fontFamily: T.fontMono,
          fontSize: 10,
          color: T.text3,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          height: GROUP_LABEL_H,
          lineHeight: `${GROUP_LABEL_H}px`,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        group · {group.node.logic}
      </div>
    </div>
  );
}

// Gate glyph as a click button. Both the root and any nested group use
// this — clicking selects the corresponding group. Phase E will swap the
// click handler for an in-drawer atomic logic toggle; for Phase C the
// drawer placeholder owns the toggle.
function GateButton({
  x,
  y,
  logic,
  selected,
  onClick,
}: {
  x: number;
  y: number;
  logic: ConditionLogic;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Group logic gate (currently ${logic})`}
      title={`Click to edit group logic (${logic})`}
      style={{
        position: "absolute",
        left: x,
        top: y - GATE_H / 2,
        width: GATE_W,
        height: GATE_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        outline: selected ? "2px solid currentColor" : "none",
        outlineOffset: 4,
        borderRadius: 12,
      }}
    >
      <GateGlyph logic={logic} size={GATE_W * 0.5} />
    </button>
  );
}

// Per-gate "add input" slot. One per group. Wide always-visible button
// attached to the gate column, semantically "add an input to this gate".
// Empty groups (no children yet) get an extra copy hint when they're the
// root of an empty tree, since they're the user's only authoring path.
function InsertSlot({
  slot,
  isTreeEmpty,
  autoOpen,
  onAutoOpenConsumed,
  onAddCondition,
  onAddGroup,
}: {
  slot: InsertionSlot;
  // True only for the root group when the entire tree is empty —
  // drives the "Click + to add your first condition or group" copy.
  isTreeEmpty: boolean;
  autoOpen: boolean;
  onAutoOpenConsumed: () => void;
  onAddCondition: () => void;
  onAddGroup: (logic: ConditionLogic) => void;
}) {
  const T = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hover, setHover] = useState(false);

  // Auto-open the picker when the parent flagged this slot (e.g. after
  // adding an empty group, surface the first-child picker so the user
  // isn't left with a dangling empty box).
  useEffect(() => {
    if (autoOpen) {
      setPickerOpen(true);
      onAutoOpenConsumed();
    }
  }, [autoOpen, onAutoOpenConsumed]);

  const x = slot.cx - slot.w / 2;
  const y = slot.cy - slot.h / 2;
  const showHint = isTreeEmpty && slot.isEmpty;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: slot.w,
        height: slot.h,
      }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((v) => !v);
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          aria-label="Add an input to this gate"
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 8,
            border: `1px dashed ${hover || pickerOpen ? T.outlineVariant : T.outlineFaint}`,
            background: hover || pickerOpen ? T.surface2 : T.surface2 + "aa",
            color: T.text2,
            cursor: "pointer",
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontFamily: T.fontMono,
            fontSize: 12,
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: 0.2,
            transition: "border-color 120ms ease, background 120ms ease",
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          <span>{slot.isEmpty ? "Add first input" : "Add input"}</span>
        </button>
        {pickerOpen && (
          <InsertPicker
            topOffset={ADD_SLOT_H + 6}
            onAddCondition={() => {
              setPickerOpen(false);
              onAddCondition();
            }}
            onAddGroup={(logic) => {
              setPickerOpen(false);
              onAddGroup(logic);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
        {showHint && (
          <div
            style={{
              position: "absolute",
              top: ADD_SLOT_H + 6,
              left: 0,
              width: "100%",
              fontFamily: T.fontMono,
              fontSize: 11,
              color: T.text3,
              textAlign: "center",
              lineHeight: 1.4,
              userSelect: "none",
              pointerEvents: "none",
            }}
          >
            Click + to add your first condition or group.
          </div>
        )}
      </div>
    </div>
  );
}

// Phase D: floating two-item picker that pops out of an inline `+` slot.
// Item 1 inserts a draft condition (handled by the parent's create-mode
// ConditionDrawer); item 2 reveals an AND/OR submenu and inserts an empty
// group. Keyboard: ↑/↓ cycle, Enter confirms, Esc closes, → opens submenu
// on the "Empty group" item.
function InsertPicker({
  topOffset,
  onAddCondition,
  onAddGroup,
  onClose,
}: {
  // Vertical offset (px) from the picker's anchor (the relative-positioned
  // shell wrapping the slot's button). For the 16px between/end button the
  // caller passes 22; for the 44px empty-group button it passes 50 — both
  // produce a 6px breathing-room gap between button and popover.
  topOffset: number;
  onAddCondition: () => void;
  onAddGroup: (logic: ConditionLogic) => void;
  onClose: () => void;
}) {
  const T = useT();
  const [focusIdx, setFocusIdx] = useState(0); // 0 = condition, 1 = group
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuIdx, setSubmenuIdx] = useState(0); // 0 = AND, 1 = OR
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Capture-phase so a click on another slot's
  // toggle doesn't end up opening a second picker on top of this one.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (submenuOpen) setSubmenuOpen(false);
      else onClose();
      return;
    }
    if (submenuOpen) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSubmenuIdx((i) => (i === 0 ? 1 : 0));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSubmenuOpen(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onAddGroup(submenuIdx === 0 ? "AND" : "OR");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => (i === 1 ? 0 : 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => (i === 0 ? 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusIdx === 0) onAddCondition();
      else setSubmenuOpen(true);
    } else if (e.key === "ArrowRight" && focusIdx === 1) {
      e.preventDefault();
      setSubmenuOpen(true);
    }
  };

  const itemBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    color: T.text2,
    fontFamily: T.fontMono,
    fontSize: 12,
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
  };
  const focusedBg = T.surface3;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        // Auto-focus the menu container so arrow-key nav works without
        // the user clicking inside first. tabIndex=-1 keeps it out of
        // the regular tab order.
        if (el && document.activeElement !== el) el.focus();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      role="menu"
      style={{
        position: "absolute",
        top: topOffset,
        left: 0,
        minWidth: 168,
        background: T.surface2,
        borderRadius: 10,
        boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 12px 32px -10px rgba(0,0,0,0.6)`,
        padding: 4,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        outline: "none",
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onAddCondition}
        onMouseEnter={() => setFocusIdx(0)}
        style={{
          ...itemBase,
          borderRadius: 6,
          background: focusIdx === 0 ? focusedBg : "transparent",
        }}
      >
        <span style={{ color: T.text3 }}>+</span> Condition
      </button>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={submenuOpen}
        onClick={() => setSubmenuOpen((v) => !v)}
        onMouseEnter={() => setFocusIdx(1)}
        style={{
          ...itemBase,
          borderRadius: 6,
          background: focusIdx === 1 ? focusedBg : "transparent",
          justifyContent: "space-between",
        }}
      >
        <span>
          <span style={{ color: T.text3 }}>+</span> Empty group
        </span>
        <span style={{ color: T.text3, fontSize: 11 }}>▸</span>
      </button>
      {submenuOpen && (
        <div
          role="menu"
          aria-label="Empty group logic"
          style={{
            position: "absolute",
            left: "100%",
            top: 32,
            marginLeft: 4,
            background: T.surface2,
            borderRadius: 10,
            boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 12px 32px -10px rgba(0,0,0,0.6)`,
            padding: 4,
            minWidth: 96,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {(["AND", "OR"] as const).map((logic, i) => (
            <button
              key={logic}
              type="button"
              role="menuitem"
              onClick={() => onAddGroup(logic)}
              onMouseEnter={() => setSubmenuIdx(i)}
              style={{
                ...itemBase,
                borderRadius: 6,
                background: submenuIdx === i ? focusedBg : "transparent",
                fontFamily: T.fontHead,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {logic}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Operator options match backend's Operator enum (schemas/strategy.py).
// `value` is the wire format; `label` is the canvas/drawer glyph.
// `hint` is the hover tooltip — kept short and plain-English so a new user
// can tell `×↑` (crosses above) from `>` (greater than) without prior
// quant background.
const OPERATOR_OPTIONS: { value: Operator; label: string; hint: string }[] = [
  { value: ">", label: ">", hint: "Greater than — the indicator is above the value." },
  { value: ">=", label: "≥", hint: "Greater than or equal to the value." },
  { value: "<", label: "<", hint: "Less than — the indicator is below the value." },
  { value: "<=", label: "≤", hint: "Less than or equal to the value." },
  { value: "==", label: "=", hint: "Equal to the value." },
  {
    value: "crosses_above",
    label: "×↑",
    hint: "Crosses above — the indicator just rose past the value (was below on the previous bar, now at or above).",
  },
  {
    value: "crosses_below",
    label: "×↓",
    hint: "Crosses below — the indicator just dropped past the value (was above on the previous bar, now at or below).",
  },
];
// Bar resolutions a condition can evaluate against. Mirrors backend's
// Timeframe enum (schemas/strategy.py). `available: false` chips render as
// locked ("coming soon") — backend rejects them today, so the UI disables
// them up-front rather than letting a save fail at validation. Daily,
// weekly and monthly are evaluated end-to-end; intraday (5m–4h) is
// reserved until PSX intraday history is deep enough to backtest against.
// Order matches the natural intraday → swing → positional progression a
// trader would scan.
const TIMEFRAMES: { value: Timeframe; label: string; available: boolean }[] = [
  { value: "5m", label: "5m", available: false },
  { value: "15m", label: "15m", available: false },
  { value: "30m", label: "30m", available: false },
  { value: "1h", label: "1h", available: false },
  { value: "4h", label: "4h", available: false },
  { value: "1D", label: "1D", available: true },
  { value: "1W", label: "1W", available: true },
  { value: "1M", label: "1M", available: true },
];

// Plain-English descriptions for the section headers in ConditionDrawer.
// Surfaced via the InfoTooltip ("i in circle") next to each Kicker so a new
// user can learn the section's purpose without reading docs.
const FIELD_INFO = {
  timeframe:
    "Which candle this condition checks. 1D = one trading day per bar, 1W = one week, 1M = one month. Higher timeframes capture broader trends; lower ones (5m, 15m, 1h…) react faster but are noisier — intraday is coming soon as we backfill enough history.",
  indicator:
    "What the strategy looks at — price (Close, Open, High, Low), a moving average (SMA/EMA), momentum (RSI, MACD), volatility (ATR, Bollinger Bands), volume, etc. Pick the data point you want this rule to watch.",
  period:
    "Lookback window for the indicator, in bars (one bar = one trading day on daily data). Larger periods are smoother and slower to react; smaller periods are noisier but quicker.",
  operator:
    "How to compare the indicator on the left to the value on the right: greater than, less than, equal, or a 'cross' that fires only the moment the line moves past the threshold.",
  comparedTo:
    "What the indicator on the left is compared against. Type a number (e.g. '30'), an indicator name (e.g. 'sma_20'), or an arithmetic expression mixing both (e.g. 'sma_20 + 5'). Suggestions appear as you type.",
} as const;

// SB-UX-REVAMP — plain-English labels used by the live condition summary at the
// top of the drawer. Mirror OPERATOR_OPTIONS hints but trimmed for inline prose.
const OPERATOR_PROSE: Record<Operator, string> = {
  ">": "greater than",
  ">=": "greater than or equal to",
  "<": "less than",
  "<=": "less than or equal to",
  "==": "equal to",
  crosses_above: "crosses above",
  crosses_below: "crosses below",
};

// Short pill labels — the cryptic `×↑` / `×↓` glyphs are replaced with
// readable words on the operator strip so a new user can read the choice
// without hovering the tooltip.
const OPERATOR_PILL: Record<Operator, string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  "==": "=",
  crosses_above: "Crosses ↑",
  crosses_below: "Crosses ↓",
};

const TIMEFRAME_PROSE: Record<Timeframe, string> = {
  "5m": "5-minute",
  "15m": "15-minute",
  "30m": "30-minute",
  "1h": "hourly",
  "4h": "4-hour",
  "1D": "daily",
  "1W": "weekly",
  "1M": "monthly",
};

// SB-UX-REVAMP — Right-hand-value input modes. `number` keeps it dead simple
// for the 80% case (RSI < 30, Price > 100). `indicator` exposes a clean
// dropdown for "Price > SMA(50)". `expression` is the existing power-user
// editor with chips and the parser — only shown when explicitly switched on.
type ValueMode = "number" | "indicator" | "expression";

// Classifies the persisted `value_source` so we can land on the right input
// mode when reopening an existing condition.
function classifyValueMode(text: string, indicators: readonly string[]): ValueMode {
  const t = text.trim();
  if (!t) return "number";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
  if (indicators.includes(t)) return "indicator";
  return "expression";
}

// SB-UX-REVAMP — one-click starter conditions for first-time users. Each
// template fills LHS + operator + RHS in a single tap so a beginner doesn't
// have to wire all four fields by hand. Only surfaced when the value is
// empty (new condition or a freshly-cleared one).
interface ConditionTemplate {
  id: string;
  label: string;
  description: string;
  indicator: string;
  operator: Operator;
  valueSource: string;
}

const CONDITION_TEMPLATES: readonly ConditionTemplate[] = [
  {
    id: "rsi-oversold",
    label: "RSI oversold",
    description: "RSI(14) < 30 — classic mean-reversion buy zone.",
    indicator: "rsi",
    operator: "<",
    valueSource: "30",
  },
  {
    id: "rsi-overbought",
    label: "RSI overbought",
    description: "RSI(14) > 70 — momentum exhaustion / sell zone.",
    indicator: "rsi",
    operator: ">",
    valueSource: "70",
  },
  {
    id: "price-above-50ma",
    label: "Price above 50-day MA",
    description: "Close > SMA(50) — uptrend filter.",
    indicator: "close_price",
    operator: ">",
    valueSource: "sma_50",
  },
  {
    id: "price-below-50ma",
    label: "Price below 50-day MA",
    description: "Close < SMA(50) — downtrend filter.",
    indicator: "close_price",
    operator: "<",
    valueSource: "sma_50",
  },
  {
    id: "golden-cross",
    label: "Golden cross (50 over 200)",
    description: "SMA(50) crosses above SMA(200) — classic long-term bull signal.",
    indicator: "sma_50",
    operator: "crosses_above",
    valueSource: "sma_200",
  },
  {
    id: "high-volume",
    label: "Unusually high volume",
    description: "Volume > volume_sma_20 — interest spike.",
    indicator: "volume",
    operator: ">",
    valueSource: "volume_sma_20",
  },
];

function DrawerContainer({ children }: { children: React.ReactNode }) {
  const T = useT();
  const { isMobile } = useBreakpoint();
  return (
    <div
      style={{
        position: "absolute",
        top: isMobile ? 0 : 16,
        right: isMobile ? 0 : 16,
        bottom: isMobile ? 0 : 16,
        left: isMobile ? 0 : "auto",
        width: isMobile ? "100%" : 380,
        maxWidth: "100%",
        background: T.surface2,
        borderRadius: isMobile ? 0 : 12,
        boxShadow: `0 0 0 1px ${T.outlineFaint}, 0 20px 60px -20px rgba(0,0,0,0.7)`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 30,
      }}
    >
      {children}
    </div>
  );
}

// Period maps indicators that have parametric variants on the backend
// (SMA_20/50/200, EMA_12/26, RSI). The period is baked into the enum
// value, so changing it remaps `cond.indicator` rather than touching
// `cond.params`. Returns null when the indicator has no parametric peer.
function getPeriodConfig(
  indicator: string,
): { current: number; choices: number[]; family: "rsi" | "sma" | "ema" } | null {
  if (indicator === "rsi") return { current: 14, choices: [14], family: "rsi" };
  const smaMatch = indicator.match(/^sma_(\d+)$/);
  if (smaMatch) return { current: Number(smaMatch[1]), choices: [20, 50, 200], family: "sma" };
  const emaMatch = indicator.match(/^ema_(\d+)$/);
  if (emaMatch) return { current: Number(emaMatch[1]), choices: [12, 26], family: "ema" };
  return null;
}

function withPeriod(indicator: string, period: number): string {
  if (indicator === "rsi") return "rsi";
  if (/^sma_\d+$/.test(indicator)) return `sma_${period}`;
  if (/^ema_\d+$/.test(indicator)) return `ema_${period}`;
  return indicator;
}

// Controlled ConditionDrawer — reads `cond` (the live SingleCondition from
// EditorView state), seeds local form state on mount, calls `onApply` with
// the next SingleCondition when the user hits Save. PR-2 wires the LHS
// indicator picker, RHS indicator picker, and period selector via
// `indicatorMeta` from /strategies/meta/indicators.
function ConditionDrawer({
  cond,
  displayName,
  indicatorMeta,
  isExitRules = false,
  onApply,
  onDelete,
  onDuplicate,
  onClose,
}: {
  cond: SingleCondition;
  displayName: string;
  indicatorMeta: IndicatorMeta;
  /** SB5 — when true, the drawer is editing an exit condition: position-state
   *  tokens are shown in the picker and exit-only preset chips appear. */
  isExitRules?: boolean;
  onApply: (next: SingleCondition) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
}) {
  const T = useT();
  // SB1: drawer state is now a single source-text string. Hydrate from the
  // backend-provided `value_source` when present (preserves user-authored
  // whitespace and parens); otherwise canonicalize the AST so legacy data
  // still opens with a sensible default.
  const initialExpressionText = cond.value_source && cond.value_source.trim()
    ? cond.value_source
    : expressionToSource(cond.value);

  const [indicator, setIndicator] = useState<string>(cond.indicator);
  const [op, setOp] = useState<Operator>(cond.operator);
  const [expressionText, setExpressionText] = useState<string>(initialExpressionText);
  // Tracks whether the current text parses + validates. Toggled by the live
  // parse callback inside ExpressionInput; consumed to disable the Apply
  // button and gate save.
  // SB5 — entry-rules context additionally rejects position-state tokens.
  const parseForContext = isExitRules ? tryParseExpression : tryParseEntryExpression;
  const [expressionOk, setExpressionOk] = useState<boolean>(() => {
    const r = parseForContext(initialExpressionText);
    return r.ok;
  });
  const [forceInvalid, setForceInvalid] = useState<boolean>(false);
  // Bar resolution. Backend defaults absent values to "1D"; if a legacy
  // condition was saved before the field existed we surface "1D" so the
  // chip row reflects the live evaluation behavior.
  const [timeframe, setTimeframe] = useState<Timeframe>(cond.timeframe ?? "1D");

  // Build Combobox options from IndicatorMeta. Group name becomes the
  // right-aligned hint; value is the wire format consumed by the backend.
  const indicatorOptions: ComboOption[] = useMemo(() => {
    const opts: ComboOption[] = [];
    for (const [group, list] of Object.entries(indicatorMeta.indicators)) {
      for (const ind of list) {
        opts.push({
          value: ind,
          label: formatIndicator(ind, null),
          keywords: ind.replace(/_/g, " "),
          hint: group.replace(/_/g, " "),
        });
      }
    }
    return opts;
  }, [indicatorMeta]);

  // Wire list of indicator names for ExpressionInput's autocomplete. The
  // editor's `indicatorMeta` is grouped by category; the parser only needs
  // the flat name list (it already enforces the closed set via
  // `KNOWN_INDICATORS`). Flat list + bare formatter keeps the dropdown row
  // legible without dragging the category hint through the parser layer.
  const expressionIndicators = useMemo(() => {
    const out: string[] = [];
    for (const list of Object.values(indicatorMeta.indicators)) {
      for (const ind of list) out.push(ind);
    }
    return out;
  }, [indicatorMeta]);

  // SB-UX-REVAMP — pick the right input mode for the RHS based on the
  // persisted expression. Empty / numeric → Number; bare indicator → Indicator;
  // anything else → Expression (so existing complex conditions still open
  // editable). User can switch tabs at any time without losing the text.
  const [valueMode, setValueMode] = useState<ValueMode>(() =>
    classifyValueMode(initialExpressionText, expressionIndicators),
  );
  // SB-UX-REVAMP — collapse advanced controls (timeframe, period, full LHS
  // picker) behind a disclosure. Open by default when editing a condition
  // whose LHS or timeframe differs from the new-condition defaults.
  const [showMoreOptions, setShowMoreOptions] = useState<boolean>(
    () =>
      (cond.timeframe && cond.timeframe !== "1D") ||
      !!getPeriodConfig(cond.indicator),
  );

  const period = getPeriodConfig(indicator);
  const lhsLabel = formatIndicator(indicator, null);
  const previewOpProse = OPERATOR_PROSE[op];

  const handleIndicatorChange = (next: string) => {
    setIndicator(next);
    // If user typed something not in the list, leave it — backend will
    // 422 on save and we'll surface that error. Free-text is intentional.
  };

  const handlePeriodChange = (n: number) => {
    setIndicator((curr) => withPeriod(curr, n));
  };

  const handleSave = () => {
    // Re-parse one last time at Apply — the debounced live state may lag a
    // final keystroke, and we'd rather block here than ship a 422.
    // SB5 — entry-rules context uses tryParseEntryExpression to catch
    // position-state tokens before they reach the backend.
    const parsed = parseForContext(expressionText);
    if (!parsed.ok) {
      setForceInvalid(true);
      setExpressionOk(false);
      return;
    }
    const next: SingleCondition = {
      kind: "condition",
      indicator,
      operator: op,
      value: parsed.ast,
      // Persist the user's exact text, not the canonical — see spec §4. Keeps
      // user-authored parens/whitespace stable across edit round-trips.
      value_source: expressionText,
      timeframe,
      params: cond.params ?? null,
    };
    onApply(next);
  };

  // SB-UX-REVAMP — Synchronously revalidate the persisted expression when the
  // Number / Indicator inputs commit a value. The Expression-mode editor has
  // its own debounced parser, so we leave it alone there.
  const updateValueText = (next: string, mode: ValueMode) => {
    setExpressionText(next);
    setForceInvalid(false);
    if (mode !== "expression") {
      const r = parseForContext(next);
      setExpressionOk(r.ok);
    }
  };

  // SB-UX-REVAMP — Apply a one-click starter template. Fills indicator +
  // operator + RHS in a single state batch so the user sees a complete
  // working condition immediately. Timeframe stays as-is so the user's
  // existing daily-vs-weekly pick is respected.
  const applyTemplate = (tpl: ConditionTemplate) => {
    setIndicator(tpl.indicator);
    setOp(tpl.operator);
    setExpressionText(tpl.valueSource);
    setForceInvalid(false);
    const nextMode = classifyValueMode(tpl.valueSource, expressionIndicators);
    setValueMode(nextMode);
    const r = parseForContext(tpl.valueSource);
    setExpressionOk(r.ok);
  };

  // SB-UX-REVAMP — live English summary that replaces the big `RSI (14)` h2
  // and the code subtitle. Trailing value falls back to "…" when empty so
  // the sentence reads naturally even before the user types.
  const summaryVerb = isExitRules ? "Exit when" : "Fire when";
  const valueLabel = (() => {
    const trimmed = expressionText.trim();
    if (!trimmed) return "…";
    // In Indicator mode the persisted wire name reads ugly inline; format it.
    if (valueMode === "indicator" && expressionIndicators.includes(trimmed)) {
      return formatIndicator(trimmed, null);
    }
    return trimmed;
  })();

  return (
    <DrawerContainer>
      {/* Header — kicker + live English summary replaces the redundant h2 */}
      <div style={{ padding: "18px 22px 14px", position: "relative", borderBottom: `1px solid ${T.outlineFaint}` }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 28,
            height: 28,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: 6,
            color: T.text3,
            cursor: "pointer",
          }}
        >
          {Icon.close}
        </button>
        <Kicker color={T.primaryLight}>condition</Kicker>
        <div
          style={{
            marginTop: 10,
            fontFamily: T.fontHead,
            fontSize: 17,
            fontWeight: 500,
            lineHeight: 1.45,
            color: T.text,
            letterSpacing: -0.2,
          }}
          aria-live="polite"
        >
          {summaryVerb}{" "}
          <span style={{ color: T.primaryLight }}>{lhsLabel}</span>{" "}
          on a <span style={{ color: T.primaryLight }}>{TIMEFRAME_PROSE[timeframe]}</span>{" "}
          chart is <span style={{ color: T.primaryLight }}>{previewOpProse}</span>{" "}
          <span style={{ color: T.primaryLight }}>{valueLabel}</span>.
        </div>
      </div>

      <div style={{ flex: 1, overflowX: "hidden", overflowY: "auto", padding: 22, paddingTop: 16 }}>
        {/* Templates — only on a fresh condition with nothing typed yet */}
        {!expressionText.trim() && !isExitRules && (
          <div style={{ marginBottom: 18 }}>
            <Kicker>start from a template</Kicker>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 8,
              }}
            >
              {CONDITION_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  title={tpl.description}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: T.fontSans,
                    fontSize: 12,
                    textAlign: "left",
                    background: T.surface,
                    color: T.text2,
                    boxShadow: `0 0 0 1px ${T.outlineFaint}`,
                    transition: "background 140ms, color 140ms",
                  }}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: T.text3 }}>
              Or fill in the fields below.
            </div>
          </div>
        )}

        {/* Compare against — the primary action. Three modes; the simple
            Number input is the default so "RSI < 50" is one keystroke away. */}
        <div>
          <Kicker info={FIELD_INFO.comparedTo}>compare {lhsLabel} to</Kicker>
          <div
            role="tablist"
            aria-label="Value input mode"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 4,
              marginTop: 8,
              padding: 3,
              borderRadius: 8,
              background: T.surfaceLow,
              border: `1px solid ${T.outlineFaint}`,
            }}
          >
            {(
              [
                { id: "number", label: "Number", hint: "e.g. 50" },
                { id: "indicator", label: "Indicator", hint: "e.g. SMA (50)" },
                { id: "expression", label: "Expression", hint: "advanced" },
              ] as { id: ValueMode; label: string; hint: string }[]
            ).map((tab) => {
              const active = valueMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setValueMode(tab.id);
                    // Switching modes does NOT clear the text; the parser will
                    // reject an inappropriate value and the inline error fires.
                    // This lets the user widen Number→Expression without losing work.
                  }}
                  title={tab.hint}
                  style={{
                    padding: "8px 0",
                    fontFamily: T.fontSans,
                    fontSize: 12,
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: active ? T.surface2 : "transparent",
                    color: active ? T.text : T.text3,
                    boxShadow: active ? `0 0 0 1px ${T.outlineFaint}` : "none",
                    transition: "background 140ms, color 140ms",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 10 }}>
            {valueMode === "number" && (
              <NumberValueInput
                value={expressionText}
                onChange={(next) => updateValueText(next, "number")}
                invalid={forceInvalid || (!!expressionText.trim() && !expressionOk)}
              />
            )}
            {valueMode === "indicator" && (
              <Combobox
                label=""
                value={
                  expressionIndicators.includes(expressionText.trim())
                    ? formatIndicator(expressionText.trim(), null)
                    : expressionText
                }
                onChange={(v) => {
                  // Map label → wire name where possible; pass typed text through.
                  const match = indicatorOptions.find(
                    (o) => o.label.toLowerCase() === v.toLowerCase() || o.value === v,
                  );
                  updateValueText(match ? match.value : v, "indicator");
                }}
                options={indicatorOptions}
                mono
                placeholder="Pick an indicator…"
                emptyHint="No matching indicator"
              />
            )}
            {valueMode === "expression" && (
              <ExpressionInput
                value={expressionText}
                onChange={(next) => {
                  setExpressionText(next);
                  setForceInvalid(false);
                }}
                onParse={(result) => setExpressionOk(result.ok)}
                indicators={expressionIndicators}
                formatIndicatorLabel={(wire) => formatIndicator(wire, null)}
                ariaLabel="Condition value expression"
                forceInvalid={forceInvalid}
                isExitRules={isExitRules}
              />
            )}
          </div>
        </div>

        {/* Operator — the comparison verb */}
        <div style={{ marginTop: 18 }}>
          <Kicker info={FIELD_INFO.operator}>operator</Kicker>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 8,
            }}
          >
            {OPERATOR_OPTIONS.map((o) => {
              const active = op === o.value;
              const pillLabel = OPERATOR_PILL[o.value];
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOp(o.value)}
                  title={o.hint}
                  style={{
                    padding: "6px 12px",
                    minWidth: 44,
                    textAlign: "center",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: T.fontSans,
                    fontSize: 12,
                    background: active ? T.primary + "22" : T.surface,
                    color: active ? T.primaryLight : T.text2,
                    boxShadow: active
                      ? `0 0 0 1.5px ${T.primary}`
                      : `0 0 0 1px ${T.outlineFaint}`,
                    transition: "background 140ms, color 140ms, box-shadow 140ms",
                  }}
                >
                  {pillLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Indicator — the LHS. Compact, no full Combobox label.
            We render this AFTER the value because most users won't change it
            (defaults to RSI or whatever was clicked), but it has to stay
            accessible for the case where they do. */}
        <div style={{ marginTop: 18 }}>
          <Kicker info={FIELD_INFO.indicator}>indicator (what to watch)</Kicker>
          <div style={{ marginTop: 8 }}>
            <Combobox
              label=""
              value={lhsLabel}
              onChange={(v) => {
                const match = indicatorOptions.find(
                  (o) => o.label.toLowerCase() === v.toLowerCase() || o.value === v,
                );
                handleIndicatorChange(match ? match.value : v);
              }}
              options={indicatorOptions}
              mono
              placeholder="Pick an indicator…"
              emptyHint="No matching indicator"
            />
          </div>
        </div>

        {/* More options — timeframe + period live here so the default surface
            stays focused on the 80% case. Open automatically when the user
            arrives at a condition that already has a non-default timeframe
            or a parametric indicator. */}
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={() => setShowMoreOptions((v) => !v)}
            aria-expanded={showMoreOptions}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: T.fontSans,
              fontSize: 12,
              color: T.text2,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span aria-hidden style={{ display: "inline-block", width: 10 }}>
              {showMoreOptions ? "▾" : "▸"}
            </span>
            More options (timeframe{period ? ", period" : ""})
          </button>

          {showMoreOptions && (
            <div style={{ marginTop: 12 }}>
              <Kicker info={FIELD_INFO.timeframe}>timeframe</Kicker>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {TIMEFRAMES.filter((tf) => tf.available).map((tf) => {
                  const active = timeframe === tf.value;
                  return (
                    <button
                      key={tf.value}
                      type="button"
                      onClick={() => setTimeframe(tf.value)}
                      aria-label={`${tf.label} timeframe`}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontSize: 12,
                        border: "none",
                        cursor: "pointer",
                        fontFamily: T.fontMono,
                        fontVariantNumeric: "tabular-nums",
                        background: active ? T.primary + "22" : T.surface,
                        color: active ? T.primaryLight : T.text2,
                        boxShadow: `0 0 0 1px ${active ? T.primary : T.outlineFaint}`,
                        transition: "background 140ms, color 140ms",
                      }}
                    >
                      {tf.label}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: T.text3,
                  fontFamily: T.fontSans,
                }}
              >
                Intraday timeframes (5m–4h) are coming soon — we&apos;re
                backfilling history.
              </div>

              {period && (
                <div style={{ marginTop: 14 }}>
                  <Kicker info={FIELD_INFO.period}>period</Kicker>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    {period.choices.map((p) => {
                      const active = p === period.current;
                      const locked = period.family === "rsi";
                      return (
                        <button
                          key={p}
                          type="button"
                          disabled={locked}
                          onClick={() => handlePeriodChange(p)}
                          title={locked ? "RSI period is fixed at 14" : undefined}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 999,
                            fontSize: 12,
                            border: "none",
                            cursor: locked ? "default" : "pointer",
                            opacity: locked ? 0.7 : 1,
                            fontFamily: T.fontMono,
                            fontVariantNumeric: "tabular-nums",
                            background: active ? T.primary + "22" : T.surface,
                            color: active ? T.primaryLight : T.text3,
                            boxShadow: `0 0 0 1px ${active ? T.primary : T.outlineFaint}`,
                            transition: "background 140ms, color 140ms",
                          }}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          padding: 14,
          borderTop: `1px solid ${T.outlineFaint}`,
          display: "flex",
          gap: 8,
        }}
      >
        {onDelete && (
          <Btn variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Btn>
        )}
        <div style={{ flex: 1 }} />
        {onDuplicate && (
          <Btn variant="outline" size="sm" onClick={onDuplicate}>
            Duplicate
          </Btn>
        )}
        <Btn
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!expressionOk || !expressionText.trim()}
        >
          Apply
        </Btn>
      </div>
    </DrawerContainer>
  );
}

// SB-UX-REVAMP — bare numeric input used by the RHS "Number" tab. We keep it
// `type="text"` with `inputMode="decimal"` so we get the mobile decimal
// keypad without losing the ability to type a leading `-` on desktop. The
// parser already accepts integers, decimals, and negatives.
function NumberValueInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
}) {
  const T = useT();
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g. 50"
      aria-label="Numeric value to compare against"
      aria-invalid={invalid}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      style={{
        width: "100%",
        padding: "10px 12px",
        fontFamily: T.fontMono,
        fontSize: 14,
        fontVariantNumeric: "tabular-nums",
        background: T.surface,
        color: T.text,
        border: "none",
        borderRadius: 8,
        outline: "none",
        boxShadow: `0 0 0 ${invalid ? 1.5 : 1}px ${invalid ? T.loss : T.outlineFaint}`,
        transition: "box-shadow 120ms",
      }}
    />
  );
}


// Phase E GroupDrawer — mirrors ConditionDrawer's shape. Exposes the AND/OR
// logic toggle, a read-only children summary, and the Ungroup / Delete
// actions. Root groups can do neither (root is the strategy itself); the
// buttons render disabled with explanatory tooltips so the affordance is
// still visible.
function GroupDrawer({
  group,
  isRoot,
  onSetLogic,
  onUngroup,
  onDelete,
  onClose,
}: {
  group: ConditionGroup;
  isRoot: boolean;
  onSetLogic: (logic: ConditionLogic) => void;
  onUngroup: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const T = useT();
  const total = group.children.length;
  const conds = group.children.filter((c) => c.kind === "condition").length;
  const subs = total - conds;
  const summary =
    total === 0
      ? "empty group"
      : `${total} child${total === 1 ? "" : "ren"} — ${conds} condition${conds === 1 ? "" : "s"}, ${subs} sub-group${subs === 1 ? "" : "s"}`;
  return (
    <DrawerContainer>
      <div
        style={{
          padding: "18px 20px 14px",
          borderBottom: `1px solid ${T.outlineFaint}`,
        }}
      >
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 10,
            color: T.text3,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          {isRoot ? "root group" : "group"}
        </div>
        <div
          style={{
            fontFamily: T.fontHead,
            fontSize: 18,
            fontWeight: 500,
            color: T.text,
            marginTop: 4,
            letterSpacing: -0.2,
          }}
        >
          {group.logic}
        </div>
        <div style={{ color: T.text3, fontSize: 12, marginTop: 4 }}>
          {summary}
        </div>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 10,
            color: T.text3,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          logic
        </div>
        <div
          role="radiogroup"
          aria-label="Group logic"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            background: T.surfaceLow,
            borderRadius: 10,
            padding: 4,
            border: `1px solid ${T.outlineFaint}`,
          }}
        >
          {(["AND", "OR"] as const).map((opt) => {
            const active = group.logic === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSetLogic(opt)}
                style={{
                  background: active ? T.primary : "transparent",
                  color: active ? T.surfaceLowest : T.text2,
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontFamily: T.fontHead,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
        <p
          style={{
            margin: 0,
            color: T.text3,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {group.logic === "AND"
            ? "All child conditions must hold for this group to fire."
            : "Any one child firing makes this group fire."}
        </p>
      </div>
      <div
        style={{
          marginTop: "auto",
          padding: 14,
          borderTop: `1px solid ${T.outlineFaint}`,
          display: "flex",
          gap: 8,
        }}
      >
        <Btn
          variant="danger"
          size="sm"
          onClick={onDelete}
          disabled={isRoot}
          title={isRoot ? "Root group can't be deleted" : "Delete this group and its children"}
        >
          Delete
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          variant="outline"
          size="sm"
          onClick={onUngroup}
          disabled={isRoot}
          title={isRoot ? "Root group can't be ungrouped" : "Replace this group with its children"}
        >
          Ungroup
        </Btn>
        <Btn variant="ghost" size="sm" onClick={onClose}>
          Close
        </Btn>
      </div>
    </DrawerContainer>
  );
}

// Phase E / Gap 21: BEFORE / AFTER preview when ungrouping a sub-group whose
// logic differs from its parent's. Cancel takes the autoFocus so a reflex
// `Enter` press is non-destructive; Ungroup is `outline`-styled (not primary)
// so muscle-memory doesn't fire it.
function UngroupConfirmModal({
  before,
  after,
  onCancel,
  onConfirm,
}: {
  before: string;
  after: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const T = useT();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <Modal onClose={onCancel} label="Ungroup this group?">
      <div style={{ padding: 24 }}>
        <div
          style={{
            fontFamily: T.fontHead,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: -0.3,
            marginBottom: 8,
          }}
        >
          Ungroup this group?
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: T.text2,
            lineHeight: 1.55,
          }}
        >
          The inner group's logic differs from its parent's, so flattening it
          changes how the strategy fires. Review the new expression below.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "70px 1fr",
            gap: "10px 12px",
            alignItems: "baseline",
            marginBottom: 18,
            fontFamily: T.fontMono,
            fontSize: 12.5,
          }}
        >
          <div style={{ color: T.text3, letterSpacing: 0.6, textTransform: "uppercase", fontSize: 10 }}>
            Before
          </div>
          <div
            style={{
              color: T.text,
              padding: "10px 12px",
              background: T.surfaceLow,
              borderRadius: 8,
              border: `1px solid ${T.outlineFaint}`,
              wordBreak: "break-word",
            }}
          >
            {before}
          </div>
          <div style={{ color: T.text3, letterSpacing: 0.6, textTransform: "uppercase", fontSize: 10 }}>
            After
          </div>
          <div
            style={{
              color: T.text,
              padding: "10px 12px",
              background: T.surfaceLow,
              borderRadius: 8,
              border: `1px solid ${T.warning}55`,
              wordBreak: "break-word",
            }}
          >
            {after}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              background: T.primary,
              color: "#fff",
              border: `1px solid ${T.primary}`,
              borderRadius: 4,
              padding: "6px 12px",
              fontFamily: T.fontSans,
              fontSize: 11.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <Btn variant="outline" size="sm" onClick={onConfirm}>
            Ungroup
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// Phase E: cascade-delete confirmation. Fires only for groups with 2+ direct
// children — single-child / empty groups are low-stakes and skip the modal.
function DeleteGroupConfirmModal({
  childCount,
  onCancel,
  onConfirm,
}: {
  childCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const T = useT();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <Modal onClose={onCancel} label="Delete this group?">
      <div style={{ padding: 24 }}>
        <div
          style={{
            fontFamily: T.fontHead,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: -0.3,
            marginBottom: 8,
          }}
        >
          Delete this group?
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: T.text2,
            lineHeight: 1.55,
          }}
        >
          This removes the group and all {childCount} of its children from the
          strategy. You can undo only by reverting unsaved changes.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              background: T.primary,
              color: "#fff",
              border: `1px solid ${T.primary}`,
              borderRadius: 4,
              padding: "6px 12px",
              fontFamily: T.fontSans,
              fontSize: 11.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <Btn variant="danger" size="sm" onClick={onConfirm}>
            Delete group
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// B047 deploy modal — single-screen universe picker (sectors + explicit
// symbols + filters) before the strategy goes live. Risk block is hidden:
// risk lives on bots/backtests, not on the deploy.
function DeployUniverseModal({
  value,
  onChange,
  stocks,
  busy,
  onCancel,
  onConfirm,
}: {
  value: UniverseAndRiskValue;
  onChange: (next: UniverseAndRiskValue) => void;
  stocks: StockResponse[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const T = useT();
  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    for (const s of stocks) {
      if (s.sector_name && s.is_active) set.add(s.sector_name);
    }
    return Array.from(set).sort();
  }, [stocks]);
  const availableSymbols = useMemo(
    () =>
      stocks
        .filter((s) => s.is_active)
        .map((s) => ({ symbol: s.symbol, name: s.name }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [stocks],
  );
  // 2026-05-11: validate scope ↔ payload inline so Confirm stays
  // disabled (with an inline reason) until the user makes a valid
  // pick. Mirrors the backend's DeployRequest validator.
  const universeErr = validateUniverseSelection(value);

  return (
    <Modal onClose={busy ? () => undefined : onCancel} label="Deploy strategy" width={720}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div
            style={{
              fontFamily: T.fontHead,
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: -0.3,
              marginBottom: 6,
            }}
          >
            Deploy strategy
          </div>
          <p style={{ margin: 0, fontSize: 13, color: T.text2, lineHeight: 1.55 }}>
            Pick the universe the signal scanner should watch. Required —
            the deploy button stays disabled until you make a choice.
          </p>
        </div>

        <UniverseAndRiskFields
          value={value}
          onChange={onChange}
          availableSectors={availableSectors}
          availableSymbols={availableSymbols}
          showRisk={false}
          disabled={busy}
        />

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
            paddingTop: 8,
            borderTop: `1px solid ${T.outlineFaint}`,
          }}
        >
          {universeErr && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 10.5,
                color: T.warning,
                marginRight: "auto",
              }}
            >
              {universeErr}
            </span>
          )}
          <Btn variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn
            variant="deploy"
            size="sm"
            onClick={onConfirm}
            disabled={busy || universeErr !== null}
            icon={Icon.spark}
          >
            {busy ? "Deploying…" : "Deploy"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}


