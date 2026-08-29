// Stone Column Portal — Design tokens
//
// RESTORED to match the original Phase 1 prototype's actual palette
// (extracted directly from the prototype file, not reinterpreted) —
// warm sage/gold/brick accents on a soft paper background with a deep
// charcoal-navy ink, rather than the all-brown/stone monochrome this
// file previously used. Components still import from here instead of
// hardcoding hex codes inline; only the values changed, not the pattern.

export const colors = {
  // Exact values from the original prototype's COLORS constant.
  ink: "#22262B",        // deep charcoal/navy — sidebar background
  inkSoft: "#3A3F46",
  paper: "#F7F4EE",       // soft off-white — page background
  paperDim: "#EFEAE1",    // light warm gray — subtle fills, dividers
  stone: "#A79B87",       // warm stone — muted secondary text (on dark)
  stoneDark: "#8B7F6C",   // muted secondary text (on light)
  sage: "#6E7B5C",        // muted olive/sage — PRIMARY accent
  sageDeep: "#57624A",
  sageTint: "#E6E9DE",
  gold: "#AD8A4E",
  goldTint: "#F1E7D3",
  brick: "#A24A3B",
  brickTint: "#F3DFDA",
  line: "#DED7C9",
  white: "#FFFFFF",
  ink2: "#5B5F66",

  // --- Compatibility aliases so existing components (BudgetTable,
  // AdminFinancialsScreen, etc.) that reference the old token names
  // don't all need simultaneous renames — mapped onto the restored
  // palette above, not new colors of their own. ---
  stone50: "#F7F4EE",
  stone100: "#EFEAE1",
  stone200: "#DED7C9",
  stone400: "#A79B87",
  stone600: "#8B7F6C",
  stone800: "#3A3F46",
  stone900: "#22262B",
  borderStrong: "#DED7C9",
  accent: "#6E7B5C",
  accentDark: "#57624A",
  success: "#57624A",
  successBg: "#E6E9DE",
  warning: "#AD8A4E",
  warningBg: "#F1E7D3",
  danger: "#A24A3B",
  dangerBg: "#F3DFDA",
  info: "#8B7F6C",
  infoBg: "#EFEAE1",
  border: "#DED7C9",

  // --- Added for the application-wide visual modernization (shared
  // ui/ primitive layer, packages/02-app-shell/src/components/ui/) ---
  // These are genuinely new tokens, not replacements — every value above
  // this line is untouched.

  /** Dedicated focus-ring color for every interactive primitive's real
   *  `:focus-visible` state (Button, TextInput, Textarea, Select,
   *  Checkbox, Tabs, MenuButton, ChecklistItem links). Same hex as
   *  `gold` — proven by the existing palette to read clearly against
   *  both the paper background and the sage/brick button fills — but
   *  named as its own semantic token so the focus-ring role can be
   *  retuned independently of gold's other uses (warning states,
   *  StatusBadge) without hunting through every usage. Used with
   *  `outline-offset` (not `box-shadow`), so it always renders against
   *  the page/card background behind the element, not the element's own
   *  fill color. */
  focusRing: "#AD8A4E",

  /** Hover/active shade for the new ui/ Button's "destructive" variant —
   *  the same relationship to `brick` that `sageDeep` already has to
   *  `sage` (a darker shade of the same hue for a pressed/hovered look).
   *  Only consumed by packages/02-app-shell/src/components/ui/. */
  brickDeep: "#823B2F",
} as const;

export const spacing = {
  xs: "4px",
  /** Added for the ui/ primitive layer (packages/02-app-shell/src/components/ui/):
   *  a genuinely missing intermediate step between `xs` (4px) and `sm`
   *  (8px). Several of that layer's controls (Button's `sm` size,
   *  FormField's label-to-control gap, Tabs' vertical padding, and
   *  ProgressBar's track thickness) independently needed exactly 6px —
   *  before this token existed that value had to be hand-typed as a
   *  bare, untraceable literal in ui/styles.ts. This is additive only;
   *  no existing spacing value changed. */
  "2xs": "6px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  xxl: "48px",
} as const;

export const radius = {
  sm: "7px",
  md: "8px",
  lg: "10px",
  pill: "999px",
} as const;

export const typography = {
  // Matches the original prototype's font choices exactly (Fraunces
  // display serif for headings, Inter for everything else).
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyDisplay: "'Fraunces', Georgia, serif",
  sizeXs: "11px",
  sizeSm: "13px",
  sizeMd: "14.5px",
  sizeLg: "18px",
  sizeXl: "28px",
  sizeXxl: "36px",
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
} as const;

export const breakpoints = {
  sm: "480px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
} as const;

export const touchTarget = {
  minSize: "44px",
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(34,38,43,0.06)",
  md: "0 4px 12px rgba(34,38,43,0.08)",
  lg: "0 12px 32px rgba(34,38,43,0.12)",
} as const;

export function tokensToCssVariables(): string {
  const flat: Record<string, string> = {
    ...prefix("color", colors),
    ...prefix("space", spacing),
    ...prefix("radius", radius),
    ...prefix("shadow", shadow),
  };
  return Object.entries(flat)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");
}

function prefix(p: string, obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${p}-${camelToKebab(k)}`, v]));
}

function camelToKebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
