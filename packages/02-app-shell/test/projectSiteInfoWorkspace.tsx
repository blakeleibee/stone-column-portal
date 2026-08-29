/**
 * P3.1 Task 5 regression coverage for ProjectSiteInfoWorkspace.tsx (the
 * "Property & Site Info" form). Same react-test-renderer pattern as
 * projectBriefWorkspace.tsx / projectContactsWorkspace.tsx in this
 * package.
 *
 * Exercises, at minimum (per the Task 5 brief):
 *   - filling in a few fields and submitting calls upsertSiteInfo with
 *     the right shape (including the tri-state boolean conversion).
 *   - every intake_item_status-typed select renders all five
 *     human-readable labels (Unknown/Requested/Received/Not
 *     Applicable/Complete), not raw enum slugs.
 *   - no field is marked required (a blank submit still succeeds — the
 *     design's own "do not make every field mandatory" requirement).
 *
 * Run with `npx tsx test/projectSiteInfoWorkspace.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { ProjectSiteInfoWorkspace } from "../src/components/ProjectSiteInfoWorkspace";
import type { ProjectSiteInfoWriteFields } from "../src/services/projectIntakeService";

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
 *  latter. */
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
  console.log("--- ProjectSiteInfoWorkspace: intake_item_status selects show all 5 human-readable labels ---");
  {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectSiteInfoWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          siteInfo: null,
          upsertSiteInfo: async () => ({}),
        })
      );
    });

    const hoaStatusSelect = findByLabelText(renderer.root, "HOA status");
    const optionLabels = hoaStatusSelect.children
      .filter((c): c is ReactTestInstance => typeof c !== "string")
      .map((c) => textOf(c));
    check("HOA status select has exactly 5 options", optionLabels.length === 5);
    check(
      "HOA status options are the human-readable labels, not raw enum slugs",
      JSON.stringify(optionLabels) === JSON.stringify(["Unknown", "Requested", "Received", "Not Applicable", "Complete"])
    );
    check("HOA status defaults to Unknown when no siteInfo row exists yet", hoaStatusSelect.props.value === "unknown");

    // Same shared renderer is used for every intake_item_status field —
    // spot-check a second one to confirm it's not a one-off HOA-specific
    // hardcode.
    const financingStatusSelect = findByLabelText(renderer.root, "Financing status");
    check("Financing status also defaults to Unknown", financingStatusSelect.props.value === "unknown");
  }

  console.log("\n--- ProjectSiteInfoWorkspace: fill fields and submit calls upsertSiteInfo with the right shape ---");
  {
    const calls: { projectId: string; fields: ProjectSiteInfoWriteFields }[] = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectSiteInfoWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          siteInfo: null,
          upsertSiteInfo: async (projectId: string, fields: ProjectSiteInfoWriteFields) => {
            calls.push({ projectId, fields });
            return {};
          },
        })
      );
    });

    act(() => {
      findByLabelText(renderer.root, "Full address").props.onChange({ target: { value: "123 Ridge Trail" } });
    });
    act(() => {
      findByLabelText(renderer.root, "Occupied during work?").props.onChange({ target: { value: "false" } });
    });
    act(() => {
      findByLabelText(renderer.root, "HOA review required?").props.onChange({ target: { value: "true" } });
    });
    act(() => {
      findByLabelText(renderer.root, "Survey status").props.onChange({ target: { value: "complete" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("upsertSiteInfo was called exactly once", calls.length === 1);
    check("upsertSiteInfo was called with the workspace's real projectId", calls[0].projectId === "project-1");
    check("submitted fullAddress matches the typed value", calls[0].fields.fullAddress === "123 Ridge Trail");
    check(
      "the tri-state 'No' selection converts to boolean false, not the string \"false\"",
      calls[0].fields.occupiedDuringWork === false
    );
    check(
      "the tri-state 'Yes' selection converts to boolean true, not the string \"true\"",
      calls[0].fields.hoaReviewRequired === true
    );
    check("submitted surveyStatus matches the selected value", calls[0].fields.surveyStatus === "complete");
  }

  console.log("\n--- ProjectSiteInfoWorkspace: no field is required — a completely blank submit still succeeds ---");
  {
    const calls: { projectId: string; fields: ProjectSiteInfoWriteFields }[] = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectSiteInfoWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          siteInfo: null,
          upsertSiteInfo: async (projectId: string, fields: ProjectSiteInfoWriteFields) => {
            calls.push({ projectId, fields });
            return {};
          },
        })
      );
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("a completely blank submit still calls upsertSiteInfo (no required-field block)", calls.length === 1);
    check("blank text fields are submitted as null, not empty strings", calls[0].fields.fullAddress === null);
    check("unset tri-state fields are submitted as null (unknown), not false", calls[0].fields.occupiedDuringWork === null);
    // The "Saved." confirmation is now the shared Alert primitive, whose
    // rendered className is "sc-ui-alert sc-ui-alert-success sc-siteinfo-saved"
    // on the host <div> — matched by class token membership on the host
    // element specifically (the Alert composite instance itself also
    // carries the un-merged className prop and would otherwise
    // double-count this match).
    const savedNodes = renderer.root.findAll(
      (n) => n.type === "div" && typeof n.props.className === "string" && n.props.className.split(" ").includes("sc-siteinfo-saved")
    );
    check("a 'Saved.' confirmation renders after a successful submit", savedNodes.length === 1);
  }

  console.log(`\nprojectSiteInfoWorkspace.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
