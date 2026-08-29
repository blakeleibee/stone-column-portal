/**
 * P3.1 Task 5 regression coverage for ProjectBriefWorkspace.tsx (the
 * "Concept & Scope" form). Mounted via react-test-renderer, same pattern
 * as projectContactsWorkspace.tsx in this package (find-by-id/label,
 * `act()`-wrapped events, assert on the Server-Action-shaped props after
 * each interaction).
 *
 * Exercises, at minimum (per the Task 5 brief):
 *   - filling in a few fields and submitting calls both Server Actions
 *     (upsertBrief AND updatePhaseTiming — this form's single "Save"
 *     button drives two underlying writes, see the component's own doc
 *     comment) with the right shape, including the cents<->dollars
 *     conversion for the budget-range fields.
 *   - the budget-range fields render the permanent "Preliminary — not a
 *     budget or contract" label (not conditionally, not a tooltip).
 *   - the client-side budget low > high guard rejects a submit without
 *     calling either Server Action.
 *   - internal_notes and client_facing_notes get visually distinct
 *     treatment (different className "badge" text/class), not just
 *     adjacent fields.
 *
 * Run with `npx tsx test/projectBriefWorkspace.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { ProjectBriefWorkspace } from "../src/components/ProjectBriefWorkspace";
import type { ProjectBriefWriteFields } from "../src/services/projectIntakeService";
import type { ProjectPhaseAndTimingWriteFields } from "../src/services/projectService";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function textOf(instance: ReactTestInstance): string {
  return instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

function isControl(n: ReactTestInstance): boolean {
  return n.type === "input" || n.type === "select" || n.type === "textarea";
}

/** Finds the form control associated with a <label> containing the given
 *  text. Supports both the legacy "control nested inside <label>" pattern
 *  AND the shared FormField primitive's pattern (a standalone
 *  <label htmlFor> sibling to the control, matched by generated id) — the
 *  visual-modernization pass moved every field in this component to the
 *  latter, but this helper stays permissive so it isn't re-litigating
 *  markup shape, only "is this control reachable via its visible label." */
function findByLabelText(root: ReactTestInstance, labelText: string): ReactTestInstance {
  const labels = root.findAllByType("label");
  const match = labels.find((l) => textOf(l).includes(labelText));
  if (!match) throw new Error(`No <label> found containing text "${labelText}"`);

  const nestedMatches = match.findAll(isControl);
  if (nestedMatches.length > 0) return nestedMatches[0];

  const htmlFor = match.props.htmlFor as string | undefined;
  if (htmlFor) {
    const byIdMatches = root.findAllByProps({ id: htmlFor }).filter(isControl);
    if (byIdMatches.length > 0) return byIdMatches[0];
  }
  throw new Error(`Label "${labelText}" has no associated input/select/textarea (nested or via htmlFor)`);
}

async function main() {
  console.log("--- ProjectBriefWorkspace: renders the permanent 'Preliminary' budget-range label ---");
  {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectBriefWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          brief: null,
          phaseTiming: null,
          upsertBrief: async () => ({}),
          updatePhaseTiming: async () => ({}),
        })
      );
    });

    // Matched against the host <div> specifically (type === "div"), not
    // just any instance with this id — the Alert primitive is now a
    // composite component whose own TestInstance also carries the
    // caller-supplied `id` prop (since it's what was passed into
    // <Alert id="...">), so a bare findByProps({ id }) would match both
    // the Alert composite instance AND the host div it renders,
    // "found 2" where exactly 1 is expected.
    const banner = renderer.root.find((n) => n.type === "div" && n.props.id === "sc-brief-preliminary-banner");
    check("the preliminary banner is rendered unconditionally (no props toggled it on)", textOf(banner).includes("Preliminary"));
    check(
      "the preliminary banner reads the exact required copy",
      textOf(banner) === "Preliminary — not a budget or contract"
    );
  }

  console.log("\n--- ProjectBriefWorkspace: internal_notes vs client_facing_notes get distinct visual treatment ---");
  {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectBriefWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          brief: null,
          phaseTiming: null,
          upsertBrief: async () => ({}),
          updatePhaseTiming: async () => ({}),
        })
      );
    });

    // Card merges its own base class with the caller's className (now
    // "sc-ui-card sc-brief-section sc-brief-notes-card sc-brief-notes-*"
    // on the rendered host <div>, post-modernization, rather than the old
    // bare className) — matched by class token membership on the host
    // <div> specifically (not the Card composite instance, whose own
    // TestInstance still carries the un-merged className the caller
    // passed in and would otherwise double-count this match) so this
    // assertion tracks "does this card's rendered element carry its own
    // distinct internal/client class," not the primitive's own
    // base-class name.
    function hasClassToken(n: ReactTestInstance, token: string): boolean {
      const className = n.props.className;
      return n.type === "div" && typeof className === "string" && className.split(" ").includes(token);
    }
    const internalCard = renderer.root.findAll((n) => hasClassToken(n, "sc-brief-notes-internal"));
    const clientCard = renderer.root.findAll((n) => hasClassToken(n, "sc-brief-notes-client"));
    check("internal notes card renders with its own distinct class", internalCard.length === 1);
    check("client-facing notes card renders with a DIFFERENT distinct class", clientCard.length === 1);
    check(
      "internal notes card is explicitly labeled staff-only",
      textOf(internalCard[0]).includes("Staff only")
    );
    check(
      "client-facing notes card shows the unpublished badge by default",
      textOf(clientCard[0]).includes("Not published")
    );
  }

  console.log("\n--- ProjectBriefWorkspace: fill fields and submit calls both actions with the right shape ---");
  {
    const briefCalls: { projectId: string; fields: ProjectBriefWriteFields }[] = [];
    const phaseCalls: { projectId: string; fields: ProjectPhaseAndTimingWriteFields }[] = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectBriefWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          brief: null,
          phaseTiming: null,
          upsertBrief: async (projectId: string, fields: ProjectBriefWriteFields) => {
            briefCalls.push({ projectId, fields });
            return {};
          },
          updatePhaseTiming: async (projectId: string, fields: ProjectPhaseAndTimingWriteFields) => {
            phaseCalls.push({ projectId, fields });
            return {};
          },
        })
      );
    });

    act(() => {
      findByLabelText(renderer.root, "Summary").props.onChange({ target: { value: "New primary residence, single story." } });
    });
    act(() => {
      findByLabelText(renderer.root, "Target budget low ($)").props.onChange({ target: { value: "500000" } });
    });
    act(() => {
      findByLabelText(renderer.root, "Target budget high ($)").props.onChange({ target: { value: "650000" } });
    });
    act(() => {
      findByLabelText(renderer.root, "Phase").props.onChange({ target: { value: "feasibility" } });
    });
    act(() => {
      findByLabelText(renderer.root, "Desired start date").props.onChange({ target: { value: "2026-09-01" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("upsertBrief (project_briefs) was called exactly once", briefCalls.length === 1);
    check("updatePhaseTiming (projects.phase/dates) was called exactly once", phaseCalls.length === 1);
    check("upsertBrief was called with the workspace's real projectId", briefCalls[0].projectId === "project-1");
    check("submitted summary matches the typed value", briefCalls[0].fields.summary === "New primary residence, single story.");
    check(
      "budget low ($500,000) was converted to integer cents (50000000), not a float dollar amount",
      briefCalls[0].fields.targetBudgetLowCents === 50_000_000
    );
    check(
      "budget high ($650,000) was converted to integer cents (65000000)",
      briefCalls[0].fields.targetBudgetHighCents === 65_000_000
    );
    check("submitted phase matches the selected value", phaseCalls[0].fields.phase === "feasibility");
    check("submitted start date matches the typed value", phaseCalls[0].fields.startDate === "2026-09-01");
    check("updatePhaseTiming was called with the same projectId", phaseCalls[0].projectId === "project-1");
  }

  console.log("\n--- ProjectBriefWorkspace: budget low > high is rejected client-side before either action is called ---");
  {
    const briefCalls: unknown[] = [];
    const phaseCalls: unknown[] = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectBriefWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          brief: null,
          phaseTiming: null,
          upsertBrief: async (...args: unknown[]) => {
            briefCalls.push(args);
            return {};
          },
          updatePhaseTiming: async (...args: unknown[]) => {
            phaseCalls.push(args);
            return {};
          },
        })
      );
    });

    act(() => {
      findByLabelText(renderer.root, "Target budget low ($)").props.onChange({ target: { value: "700000" } });
    });
    act(() => {
      findByLabelText(renderer.root, "Target budget high ($)").props.onChange({ target: { value: "500000" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("neither action was called when budget low > high", briefCalls.length === 0 && phaseCalls.length === 0);
    // The error banner is now the shared Alert primitive, whose rendered
    // className is "sc-ui-alert sc-ui-alert-error sc-brief-error" (base
    // classes + the caller's own className) rather than a bare
    // "sc-brief-error" string — matched by class token membership on the
    // host <div> specifically, since the Alert composite instance itself
    // also carries the un-merged className prop and would otherwise
    // double-count this match (same reasoning as the internal/client
    // notes card check above).
    const errorNodes = renderer.root.findAll(
      (n) => n.type === "div" && typeof n.props.className === "string" && n.props.className.split(" ").includes("sc-brief-error")
    );
    check("an inline error is shown for the inconsistent budget range", errorNodes.length === 1);
    check("the error mentions the budget range", textOf(errorNodes[0]).toLowerCase().includes("budget"));
  }

  console.log(`\nprojectBriefWorkspace.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
