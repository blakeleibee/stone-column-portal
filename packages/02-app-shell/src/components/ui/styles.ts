// Stone Column Portal — shared UI primitive stylesheet.
//
// One CSS string, built entirely from `../../design/tokens` (colors,
// spacing, radius, typography, shadow, breakpoints, touchTarget) — never
// a hardcoded hex/px value for anything a token already exists for. Every
// number below that a spacing/radius/typography token already equals
// (or that a genuinely missing intermediate step — `spacing["2xs"]`,
// added alongside this file — now covers) is referenced through that
// token, not re-typed as a literal.
//
// The literal numbers that remain are each one of a few narrow,
// explicitly-commented-at-point-of-use categories with no spacing-scale
// equivalent to trace to:
//   - border/outline widths and small (<=2px) alignment nudges (1px/2px)
//   - a box-shadow's own offset/blur shape (e.g. `inset 0 1px 3px ...`)
//     — the same un-tokenized convention `shadow.sm/md/lg` themselves
//     already use for their own offset/blur digits in tokens.ts
//   - component-intrinsic sizes pinned to an already-shipped, out-of-
//     scope screen's own hardcoded dimension (so a future migration is a
//     pixel-exact swap) or otherwise structural (a dropdown's min-width,
//     a textarea's default height, a description's max line length) —
//     each one commented where it appears, several with a direct
//     precedent already in this codebase's existing (out-of-scope) CSS.
// This is the same category of literal the plan's own audit treated as
// fine ("no invented colors/spacing," not "zero literal numbers ever").
//
// Injected exactly ONCE, inside AppShell.tsx (see that file's own
// comment for why AppShell is "once per page" and why this stylesheet is
// deliberately kept SEPARATE from AppShell's existing `shellStyles`
// rather than merged into it).
//
// Every rule is prefixed `sc-ui-` (never `sc-projects-`/`sc-team-`/
// `sc-contact-`/`sc-setup-`, which remain the OLD per-screen ad-hoc
// classes this layer is meant to replace in a later migration phase —
// keeping the prefixes distinct means this stylesheet can be injected
// today with zero risk of colliding with or overriding any existing
// screen's own styles).
import { colors, spacing, radius, typography, shadow, breakpoints, touchTarget } from "../../design/tokens";

/** Derives an rgba() string from a token hex color rather than
 *  hand-typing a second, independently-maintained decimal copy of that
 *  color's RGB triple (which is how `shadow.sm`/`md`/`lg` themselves are
 *  already authored in tokens.ts — `rgba(34,38,43,0.06)` there is
 *  `colors.ink` decomposed by hand). Used below for translucent overlays
 *  (pressed-button insets, spinner tracks) that a plain hex can't
 *  express — every one of those still traces to `colors.ink`/
 *  `colors.white` through this function, not a re-typed literal. */
function alpha(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const uiStyles = `
/* =====================================================================
   Button
   ===================================================================== */
.sc-ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.xs};
  min-height: ${touchTarget.minSize};
  padding: ${spacing.sm} ${spacing.md};
  border-radius: ${radius.sm};
  border: 1px solid transparent;
  font-family: ${typography.fontFamily};
  font-size: ${typography.sizeSm};
  font-weight: ${typography.weightMedium};
  line-height: 1.2;
  cursor: pointer;
  text-decoration: none;
  box-sizing: border-box;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.sc-ui-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-ui-btn-sm { min-height: auto; padding: ${spacing["2xs"]} ${spacing.sm}; font-size: ${typography.sizeXs}; }

.sc-ui-btn-primary { background: ${colors.sage}; border-color: ${colors.sage}; color: ${colors.white}; }
.sc-ui-btn-primary:hover:not(:disabled) { background: ${colors.sageDeep}; border-color: ${colors.sageDeep}; }
.sc-ui-btn-primary:active:not(:disabled) { background: ${colors.sageDeep}; box-shadow: inset 0 1px 3px ${alpha(colors.ink, 0.25)}; }

.sc-ui-btn-secondary { background: ${colors.white}; border-color: ${colors.line}; color: ${colors.ink2}; }
.sc-ui-btn-secondary:hover:not(:disabled) { background: ${colors.paperDim}; border-color: ${colors.stone}; }
.sc-ui-btn-secondary:active:not(:disabled) { background: ${colors.paperDim}; box-shadow: inset 0 1px 3px ${alpha(colors.ink, 0.12)}; }

/* "muted, not alarming-red" per the modernization plan: an outlined
   brick treatment (text+border only) rather than a solid red fill —
   escalates to a brick-tinted fill only on hover/active/press, the same
   restrained escalation-on-interaction the plan asks for. */
.sc-ui-btn-destructive { background: transparent; border-color: ${colors.brick}; color: ${colors.brick}; }
.sc-ui-btn-destructive:hover:not(:disabled) { background: ${colors.brickTint}; }
.sc-ui-btn-destructive:active:not(:disabled) { background: ${colors.brickTint}; border-color: ${colors.brickDeep}; color: ${colors.brickDeep}; }

.sc-ui-btn:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }

.sc-ui-btn-label { display: inline-flex; align-items: center; }
.sc-ui-spinner {
  /* Sized to the button's own font-size (13px === typography.sizeSm) —
     a spinner reading as "about one character tall" next to its label
     is a deliberate, common idiom (equivalent to a 1em spinner), not a
     coincidental reuse of a font-size token for a width/height. */
  width: ${typography.sizeSm};
  height: ${typography.sizeSm};
  border-radius: ${radius.pill};
  border: 2px solid ${alpha(colors.white, 0.4)};
  border-top-color: currentColor;
  animation: sc-ui-spin 0.6s linear infinite;
  flex-shrink: 0;
}
.sc-ui-btn-secondary .sc-ui-spinner,
.sc-ui-btn-destructive .sc-ui-spinner { border-color: ${alpha(colors.ink, 0.2)}; border-top-color: currentColor; }
@keyframes sc-ui-spin { to { transform: rotate(360deg); } }

/* =====================================================================
   TextInput / Textarea / Select
   ===================================================================== */
.sc-ui-input, .sc-ui-textarea, .sc-ui-select {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: ${spacing.sm};
  border: 1px solid ${colors.line};
  border-radius: ${radius.sm};
  font-family: ${typography.fontFamily};
  font-size: ${typography.sizeSm};
  color: ${colors.ink};
  background: ${colors.white};
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
/* 72px: a component-intrinsic default height (roughly 4 lines of text),
   not a spacing/gap value — same category and same precedent as the
   pre-existing (out-of-scope) ProjectListWorkspace.tsx's own
   ".sc-projects-textarea { min-height: 56px; }". No spacing token
   represents "how tall should an empty textarea look," so this stays a
   literal structural default. */
.sc-ui-textarea { resize: vertical; min-height: 72px; }
.sc-ui-input::placeholder, .sc-ui-textarea::placeholder { color: ${colors.stone}; }
.sc-ui-input:hover:not(:disabled):not(:focus-visible),
.sc-ui-textarea:hover:not(:disabled):not(:focus-visible),
.sc-ui-select:hover:not(:disabled):not(:focus-visible) { border-color: ${colors.stone}; }
.sc-ui-input:disabled, .sc-ui-textarea:disabled, .sc-ui-select:disabled {
  background: ${colors.paperDim};
  color: ${colors.stoneDark};
  cursor: not-allowed;
  opacity: 0.85;
}
.sc-ui-input-error, .sc-ui-textarea-error, .sc-ui-select-error { border-color: ${colors.brick}; }
.sc-ui-input:focus-visible, .sc-ui-textarea:focus-visible, .sc-ui-select:focus-visible {
  outline: 2px solid ${colors.focusRing};
  outline-offset: 1px;
  border-color: ${colors.sage};
}
.sc-ui-input-error:focus-visible, .sc-ui-textarea-error:focus-visible, .sc-ui-select-error:focus-visible {
  border-color: ${colors.brick};
}

/* =====================================================================
   Checkbox
   ===================================================================== */
.sc-ui-checkbox {
  display: inline-flex;
  align-items: flex-start;
  gap: ${spacing.xs};
  font-size: ${typography.sizeSm};
  color: ${colors.ink};
  cursor: pointer;
}
.sc-ui-checkbox-input {
  width: ${spacing.md};
  height: ${spacing.md};
  /* 2px: a small alignment nudge (centers the box against the first
     line of a multi-line label), the same structural category as this
     file's border/outline widths — not a layout-defining spacing value. */
  margin-top: 2px;
  accent-color: ${colors.sage};
  flex-shrink: 0;
  cursor: pointer;
}
.sc-ui-checkbox-input-error { outline: 1px solid ${colors.brick}; outline-offset: 1px; }
.sc-ui-checkbox-input:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }
.sc-ui-checkbox-input:disabled { cursor: not-allowed; }
.sc-ui-checkbox-label { line-height: 1.4; }

/* =====================================================================
   FormField / FormGrid
   ===================================================================== */
.sc-ui-field { display: flex; flex-direction: column; gap: ${spacing["2xs"]}; }
.sc-ui-field-label {
  font-size: ${typography.sizeXs};
  font-weight: ${typography.weightSemibold};
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: ${colors.stoneDark};
}
.sc-ui-field-required { color: ${colors.brick}; margin-left: ${spacing.xs}; }
.sc-ui-field-hint { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; }
.sc-ui-field-error { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.brick}; }

.sc-ui-form-grid { display: grid; gap: ${spacing.md}; align-items: start; }
.sc-ui-form-grid-2 { grid-template-columns: repeat(2, 1fr); }
.sc-ui-form-grid-3 { grid-template-columns: repeat(3, 1fr); }
@media (max-width: ${breakpoints.sm}) {
  .sc-ui-form-grid-2, .sc-ui-form-grid-3 { grid-template-columns: 1fr; }
}

/* =====================================================================
   Card
   ===================================================================== */
.sc-ui-card {
  background: ${colors.white};
  border: 1px solid ${colors.line};
  border-radius: ${radius.lg};
  box-shadow: ${shadow.sm};
  padding: ${spacing.lg};
  box-sizing: border-box;
}
.sc-ui-card-compact { padding: ${spacing.md}; }

/* =====================================================================
   PageHeader
   ===================================================================== */
.sc-ui-page-header { display: flex; flex-direction: column; gap: ${spacing.sm}; margin-bottom: ${spacing.lg}; }
.sc-ui-page-header-row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: ${spacing.md}; }
.sc-ui-page-header-text { min-width: 0; }
.sc-ui-page-header-title { margin: 0; font-family: ${typography.fontFamilyDisplay}; font-size: ${typography.sizeXl}; color: ${colors.ink}; overflow-wrap: anywhere; }
.sc-ui-page-header-subtitle { margin: ${spacing.xs} 0 0 0; color: ${colors.ink2}; font-size: ${typography.sizeSm}; }
.sc-ui-page-header-actions { display: flex; gap: ${spacing.sm}; flex-shrink: 0; flex-wrap: wrap; }

/* =====================================================================
   Badge / StatusBadge
   ===================================================================== */
.sc-ui-badge {
  display: inline-flex;
  align-items: center;
  /* Was a hand-typed "3px 9px" — the closest token pairing is
     xs/sm (4px/8px), a visually negligible ±1px rounding, and this
     component isn't consumed by any screen yet so there's no rendered
     regression to reconcile. */
  padding: ${spacing.xs} ${spacing.sm};
  border-radius: ${radius.pill};
  font-size: ${typography.sizeXs};
  font-weight: ${typography.weightSemibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.sc-ui-badge-neutral { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-ui-badge-sage { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-ui-badge-gold { background: ${colors.goldTint}; color: ${colors.gold}; }
.sc-ui-badge-brick { background: ${colors.brickTint}; color: ${colors.brick}; }
.sc-ui-badge-ink { background: ${colors.ink}; color: ${colors.paper}; }

/* =====================================================================
   Alert
   ===================================================================== */
.sc-ui-alert { border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; font-size: ${typography.sizeSm}; }
.sc-ui-alert-title { margin: 0 0 ${spacing.xs} 0; font-weight: ${typography.weightSemibold}; }
.sc-ui-alert-body { margin: 0; line-height: 1.5; }
.sc-ui-alert-info { background: ${colors.infoBg}; color: ${colors.ink}; }
.sc-ui-alert-success { background: ${colors.successBg}; color: ${colors.sageDeep}; }
.sc-ui-alert-warning { background: ${colors.warningBg}; color: ${colors.gold}; }
.sc-ui-alert-error { background: ${colors.dangerBg}; color: ${colors.brick}; }

/* =====================================================================
   EmptyState
   ===================================================================== */
.sc-ui-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: ${spacing.xs};
  padding: ${spacing.xl} ${spacing.md};
  color: ${colors.stoneDark};
}
.sc-ui-empty-state-icon { font-size: ${typography.sizeXl}; color: ${colors.stone}; line-height: 1; }
.sc-ui-empty-state-title { margin: 0; font-size: ${typography.sizeMd}; font-weight: ${typography.weightSemibold}; color: ${colors.ink2}; }
/* 420px: a line-length cap for readability, not a spacing value — same
   precedent as the pre-existing (out-of-scope) ProjectListWorkspace.tsx's
   own ".sc-projects-field { max-width: 420px; }". */
.sc-ui-empty-state-description { margin: 0; font-size: ${typography.sizeSm}; max-width: 420px; }
.sc-ui-empty-state-action { margin-top: ${spacing.xs}; }

/* =====================================================================
   Tabs
   ===================================================================== */
.sc-ui-tabs { display: flex; flex-wrap: wrap; gap: ${spacing.xs}; }
.sc-ui-tab {
  display: inline-flex;
  align-items: center;
  min-height: ${touchTarget.minSize};
  /* Compact pass (owner-preview polish, item 2): tightened from
     spacing["2xs"] (6px) to spacing.xs (4px) vertical — a modest few-px
     reduction, not a resize. box-sizing: border-box is required for
     min-height to actually cap the real rendered height at
     touchTarget.minSize: Tabs.tsx renders this as an <a href> for the
     Active/Completed/Archived project-list tabs (the only href-based
     Tabs usage in the app), and anchors don't get the UA-stylesheet
     border-box default that <button>s get — without this rule .sc-ui-tab
     computed content-box, so padding/border stacked on top of the 44px
     min-height instead of being absorbed by it (measured 54px live).
     Every other sized rule in this file already sets box-sizing:
     border-box explicitly for the same reason. */
  box-sizing: border-box;
  padding: ${spacing.xs} ${spacing.sm};
  border-radius: ${radius.pill};
  border: 1px solid ${colors.line};
  background: ${colors.white};
  color: ${colors.ink2};
  font-size: ${typography.sizeSm};
  font-family: ${typography.fontFamily};
  text-decoration: none;
  cursor: pointer;
}
.sc-ui-tab:hover:not(.sc-ui-tab-active):not(:disabled) { background: ${colors.paperDim}; }
.sc-ui-tab-active { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-ui-tab:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-ui-tab:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }

/* =====================================================================
   ProgressBar
   ===================================================================== */
.sc-ui-progress { display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-ui-progress-label {
  margin: 0;
  font-size: ${typography.sizeXs};
  font-weight: ${typography.weightSemibold};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${colors.stoneDark};
}
.sc-ui-progress-track { width: 100%; height: ${spacing["2xs"]}; border-radius: ${radius.pill}; background: ${colors.paperDim}; overflow: hidden; }
.sc-ui-progress-fill { height: 100%; background: ${colors.sage}; border-radius: ${radius.pill}; transition: width 0.2s ease; }

/* =====================================================================
   ChecklistItem
   ===================================================================== */
.sc-ui-checklist-item { display: flex; align-items: center; gap: ${spacing.sm}; padding: ${spacing.sm} ${spacing.xs}; border-radius: ${radius.sm}; }
.sc-ui-checklist-item-inert { opacity: 0.72; }
.sc-ui-checklist-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 22px is deliberately pinned to the already-shipped
     ProjectSetupChecklist.tsx's own ".sc-setup-check" circle diameter
     (out of scope for this task) so a future migration to this
     component is a pixel-exact swap, not a visual change — same
     "un-tokenized, fixed icon-size constant" category AppShell.tsx's own
     IconPlaceholder already uses (20px/18px, also un-tokenized) rather
     than a spacing-scale value. */
  width: 22px;
  height: 22px;
  border-radius: ${radius.pill};
  font-size: ${typography.sizeSm};
  font-weight: ${typography.weightSemibold};
  background: ${colors.sage};
  color: ${colors.white};
  flex-shrink: 0;
}
.sc-ui-checklist-check-inert { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-ui-checklist-check-available { background: ${colors.gold}; color: ${colors.white}; }
.sc-ui-checklist-check-complete { background: ${colors.sage}; color: ${colors.white}; }
.sc-ui-checklist-label { flex: 1; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
/* Suffixes here are STATUS_CLASS_SUFFIX's mapped values (see
   ChecklistItem.tsx) rather than the raw ChecklistItemStatus enum
   strings — this stylesheet is injected unconditionally on every page
   (admin and client alike), so its own selector text must never spell
   out a raw internal-status enum value verbatim; ChecklistItem.tsx's
   comment has the full reasoning. */
.sc-ui-checklist-status { font-size: ${typography.sizeXs}; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; color: ${colors.sageDeep}; }
.sc-ui-checklist-status-pending { color: ${colors.stoneDark}; }
.sc-ui-checklist-status-inprogress { color: ${colors.gold}; }
.sc-ui-checklist-status-complete { color: ${colors.sageDeep}; }
.sc-ui-checklist-status-available { color: ${colors.sageDeep}; }
.sc-ui-checklist-status-inert { color: ${colors.stoneDark}; }
.sc-ui-checklist-link {
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  width: 100%;
  padding: ${spacing.sm} ${spacing.xs};
  border-radius: ${radius.sm};
  text-decoration: none;
  color: inherit;
  box-sizing: border-box;
  background: ${colors.paperDim};
  border: none;
  font-family: ${typography.fontFamily};
  text-align: left;
  cursor: pointer;
}
.sc-ui-checklist-link:hover { background: ${colors.sageTint}; }
.sc-ui-checklist-link:disabled { cursor: not-allowed; opacity: 0.7; }
.sc-ui-checklist-link:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }

/* =====================================================================
   MenuButton
   ===================================================================== */
.sc-ui-menu { position: relative; display: inline-block; }
/* Compact trigger (owner-preview polish, item 4): was wide default-
   button sizing (min-height touchTarget.minSize, padding spacing.sm/md,
   sizeSm font) that read as a second full-width button next to the
   adjacent size="sm" row actions. Now padding/font-size/line-height/
   border match Button's own .sc-ui-btn-sm exactly (spacing["2xs"]/sm
   padding, sizeXs font, 1.2 line-height, 1px border) so a MenuButton
   trigger sitting next to a size="sm" Button in the same row is the
   same computed height, not a taller/wider outlier. font-weight is
   also matched explicitly (weightMedium) — .sc-ui-btn's base rule sets
   this for every Button variant/size including sm, but this trigger has
   no equivalent base rule to inherit it from, so without this line it
   would silently compute the browser default (400) next to sm Buttons'
   500 (confirmed live via CDP). */
.sc-ui-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.xs};
  min-height: auto;
  padding: ${spacing["2xs"]} ${spacing.sm};
  border-radius: ${radius.sm};
  border: 1px solid ${colors.line};
  background: ${colors.white};
  color: ${colors.ink2};
  font-size: ${typography.sizeXs};
  font-weight: ${typography.weightMedium};
  font-family: ${typography.fontFamily};
  line-height: 1.2;
  box-sizing: border-box;
  cursor: pointer;
}
.sc-ui-menu-trigger:hover { background: ${colors.paperDim}; }
.sc-ui-menu-trigger:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }
.sc-ui-menu-list {
  position: absolute;
  top: calc(100% + ${spacing.xs});
  z-index: 20;
  /* 180px: a dropdown-panel width floor, not a spacing value — same
     un-tokenized structural-width precedent as the pre-existing
     (out-of-scope) ProjectTeamWorkspace.tsx's own
     ".sc-team-input { min-width: 260px; }". */
  min-width: 180px;
  background: ${colors.white};
  border: 1px solid ${colors.line};
  border-radius: ${radius.md};
  box-shadow: ${shadow.md};
  padding: ${spacing.xs};
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.sc-ui-menu-list-end { right: 0; }
.sc-ui-menu-list-start { left: 0; }
.sc-ui-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: ${spacing.sm};
  border: none;
  background: none;
  border-radius: ${radius.sm};
  font-size: ${typography.sizeSm};
  font-family: ${typography.fontFamily};
  color: ${colors.ink};
  cursor: pointer;
  box-sizing: border-box;
}
.sc-ui-menu-item:hover:not(:disabled) { background: ${colors.paperDim}; }
.sc-ui-menu-item:disabled { opacity: 0.5; cursor: not-allowed; }
.sc-ui-menu-item:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: -2px; }
`;
