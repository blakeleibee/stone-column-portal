import React from "react";
import { colors } from "../../../../packages/02-app-shell/src/design/tokens";

export type BadgeTone = "neutral" | "sage" | "gold" | "brick" | "ink";

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.paperDim, fg: colors.ink2 },
    sage: { bg: colors.sageTint, fg: colors.sageDeep },
    gold: { bg: colors.goldTint, fg: colors.gold },
    brick: { bg: colors.brickTint, fg: colors.brick },
    ink: { bg: colors.ink, fg: colors.paper },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: "999px",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Matches the original prototype's statusTone() mapping exactly. */
export function statusTone(status: string): BadgeTone {
  const map: Record<string, BadgeTone> = {
    complete: "sage", "on-track": "sage", "in-progress": "gold", upcoming: "neutral",
    "not-started": "neutral", over: "brick", delayed: "brick", Approved: "sage",
    Ordered: "sage", "Submitted for approval": "gold", "Client decision required": "brick",
    "Options being reviewed": "gold", "Not started": "neutral", Published: "sage", Draft: "neutral",
    Open: "gold", "Waiting on Stone Column": "gold", "Waiting on client": "brick", Resolved: "sage",
    "Needs attention today": "brick", "Waiting on vendor": "gold", "Upcoming this week": "neutral",
  };
  return map[status] || "neutral";
}

export function PhotoPlaceholder() {
  return (
    <div
      style={{
        background: colors.paperDim,
        borderRadius: "8px",
        height: "110px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.stoneDark,
        fontSize: "11px",
      }}
    >
      Photo placeholder
    </div>
  );
}
