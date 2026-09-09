/**
 * P3.1 Task 8 regression coverage for ProjectPricingWorkspace.tsx.
 * Mounted via react-test-renderer, same pattern as
 * projectContactsWorkspace.tsx / projectListWorkspace_pricingModel.tsx's
 * own "Mounted" sections in this package (find-by-id, `act()`-wrapped
 * events, assert on props/state after each interaction).
 *
 * Exercises, at minimum (per the Task 8 brief):
 *   - the "not yet determined" empty state renders when
 *     `feeTerms.pricingModel` is null.
 *   - submitting valid fee data calls `setFeeTerms` with the right shape
 *     (percentage-basis and fixed-basis cases), and reloads via
 *     `refreshFeeTerms` afterward.
 *   - the current-terms summary renders real values (not the empty
 *     state) once pricing is set.
 *   - a non-admin session never renders the write form at all (only the
 *     read-only restricted note) — the judgment call flagged in the
 *     Task 8 brief.
 *
 * Run with `npx tsx test/projectPricingWorkspace.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { ProjectPricingWorkspace } from "../src/components/ProjectPricingWorkspace";
import type { ProjectFeeTermsRow } from "../src/services/projectService";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

/** Finds the host DOM element with the given id. Filters to host (string
 *  `type`) instances specifically — the shared TextInput/Select
 *  primitives are `forwardRef` components, so a plain `findByProps({id})`
 *  matches BOTH the composite primitive's own TestInstance (which also
 *  carries the id, since that's what the caller passed to it) AND the
 *  host <input>/<select> it renders, "found 2" where exactly 1 is
 *  wanted. */
function findById(root: ReactTestInstance, id: string): ReactTestInstance {
  const matches = root.findAllByProps({ id }).filter((n) => typeof n.type === "string");
  if (matches.length !== 1) throw new Error(`Expected exactly 1 host element with id "${id}", found ${matches.length}`);
  return matches[0];
}

function textOf(instance: ReactTestInstance): string {
  return instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

const NOT_DETERMINED: ProjectFeeTermsRow = {
  pricingModel: null,
  pricingModelLabel: null,
  feeBasis: null,
  feeBasisPoints: null,
  feeFixedAmountCents: null,
};

const PERCENTAGE_TERMS: ProjectFeeTermsRow = {
  pricingModel: "cost_plus_percentage",
  pricingModelLabel: "Cost-plus 15%",
  feeBasis: "percentage",
  feeBasisPoints: 1500,
  feeFixedAmountCents: null,
};

async function main() {
  console.log("--- 'Not yet determined' empty state renders when nothing is set ---");
  {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectPricingWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          isAdmin: true,
          feeTerms: NOT_DETERMINED,
          setFeeTerms: async () => ({}),
          refreshFeeTerms: async () => ({ feeTerms: NOT_DETERMINED }),
        })
      );
    });

    check(
      'the "Not yet determined" empty state is rendered',
      JSON.stringify(renderer.toJSON()).includes("Not yet determined")
    );
    check(
      "no current-terms <dl> summary is rendered while pricing is unset",
      renderer.root.findAllByProps({ className: "sc-pricing-summary" }).length === 0
    );
  }

  console.log("\n--- Current-terms summary renders real values once pricing is set ---");
  {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectPricingWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          isAdmin: true,
          feeTerms: PERCENTAGE_TERMS,
          setFeeTerms: async () => ({}),
          refreshFeeTerms: async () => ({ feeTerms: PERCENTAGE_TERMS }),
        })
      );
    });

    const json = JSON.stringify(renderer.toJSON());
    check('no longer shows the "Not yet determined" empty state', !json.includes("Not yet determined"));
    check("shows the human-readable pricing model label", json.includes("Cost-Plus (% Fee)"));
    check("shows the pricing_model_label free-text value", json.includes("Cost-plus 15%"));
    check("shows the fee percentage, converted from basis points (1500bp -> 15%)", json.includes("15%"));
  }

  console.log("\n--- Submitting valid percentage fee data calls setFeeTerms with the right shape ---");
  {
    const setFeeTermsCalls: any[] = [];
    let refreshCallCount = 0;
    const updatedTerms: ProjectFeeTermsRow = { ...PERCENTAGE_TERMS, feeBasisPoints: 1250, pricingModelLabel: null };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectPricingWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          isAdmin: true,
          feeTerms: NOT_DETERMINED,
          setFeeTerms: async (params: any) => {
            setFeeTermsCalls.push(params);
            return {};
          },
          refreshFeeTerms: async (projectId: string) => {
            refreshCallCount++;
            check("refreshFeeTerms is called with the workspace's own projectId", projectId === "project-1");
            return { feeTerms: updatedTerms };
          },
        })
      );
    });

    // Default select value is already cost_plus_percentage (matches the
    // create-form default) — only the fee percentage input needs a value.
    act(() => {
      findById(renderer.root, "sc-pricing-fee-pct").props.onChange({ target: { value: "12.5" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("setFeeTerms was called exactly once", setFeeTermsCalls.length === 1);
    check("called with the workspace's real projectId", setFeeTermsCalls[0].projectId === "project-1");
    check("called with pricingModel 'cost_plus_percentage'", setFeeTermsCalls[0].pricingModel === "cost_plus_percentage");
    check("called with feeBasis 'percentage'", setFeeTermsCalls[0].feeBasis === "percentage");
    check("feeBasisPoints is correctly converted (12.5% -> 1250bp)", setFeeTermsCalls[0].feeBasisPoints === 1250);
    check("feeFixedAmountCents is null for a percentage-basis submit", setFeeTermsCalls[0].feeFixedAmountCents === null);
    check("pricingModelLabel is null when left blank", setFeeTermsCalls[0].pricingModelLabel === null);
    check("the list was reloaded via refreshFeeTerms after a successful save", refreshCallCount === 1);
    check(
      "a success message is shown after a successful save",
      JSON.stringify(renderer.toJSON()).includes("Pricing/fee terms saved.")
    );
  }

  console.log("\n--- Submitting valid fixed-fee data calls setFeeTerms with the right shape ---");
  {
    const setFeeTermsCalls: any[] = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectPricingWorkspace, {
          projectId: "project-2",
          projectName: "Another Project",
          isAdmin: true,
          feeTerms: NOT_DETERMINED,
          setFeeTerms: async (params: any) => {
            setFeeTermsCalls.push(params);
            return {};
          },
          refreshFeeTerms: async () => ({ feeTerms: NOT_DETERMINED }),
        })
      );
    });

    act(() => {
      findById(renderer.root, "sc-pricing-model").props.onChange({ target: { value: "cost_plus_fixed_fee" } });
    });
    // Host-only counts (see findById's own comment) — TextInput is a
    // forwardRef primitive now, so a raw findAllByProps({id}) would also
    // match its own composite TestInstance alongside the host <input>.
    check(
      "the fixed-fee input is shown instead of the percentage input",
      renderer.root.findAllByProps({ id: "sc-pricing-fee-fixed" }).filter((n) => typeof n.type === "string").length === 1 &&
        renderer.root.findAllByProps({ id: "sc-pricing-fee-pct" }).filter((n) => typeof n.type === "string").length === 0
    );
    act(() => {
      findById(renderer.root, "sc-pricing-fee-fixed").props.onChange({ target: { value: "5000" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    check("setFeeTerms was called exactly once", setFeeTermsCalls.length === 1);
    check("called with pricingModel 'cost_plus_fixed_fee'", setFeeTermsCalls[0].pricingModel === "cost_plus_fixed_fee");
    check("called with feeBasis 'fixed'", setFeeTermsCalls[0].feeBasis === "fixed");
    check("feeFixedAmountCents is correctly converted ($5000 -> 500000 cents)", setFeeTermsCalls[0].feeFixedAmountCents === 500000);
    check("feeBasisPoints is null for a fixed-basis submit", setFeeTermsCalls[0].feeBasisPoints === null);
  }

  console.log("\n--- A negative/out-of-range fee percentage is rejected client-side ---");
  {
    const setFeeTermsCalls: any[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectPricingWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          isAdmin: true,
          feeTerms: NOT_DETERMINED,
          setFeeTerms: async (params: any) => {
            setFeeTermsCalls.push(params);
            return {};
          },
          refreshFeeTerms: async () => ({ feeTerms: NOT_DETERMINED }),
        })
      );
    });

    act(() => {
      findById(renderer.root, "sc-pricing-fee-pct").props.onChange({ target: { value: "-5" } });
    });
    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });
    check("a negative fee percentage is rejected (no setFeeTerms call)", setFeeTermsCalls.length === 0);
    // The error banner is now the shared Alert primitive, whose rendered
    // className is "sc-ui-alert sc-ui-alert-error sc-pricing-error" on
    // the host <div> — matched by class token membership on the host
    // element specifically (the Alert composite instance itself also
    // carries the un-merged className prop and would otherwise
    // double-count this match).
    const errors = renderer.root.findAll(
      (n) => n.type === "div" && typeof n.props.className === "string" && n.props.className.split(" ").includes("sc-pricing-error")
    );
    check(
      "a validation error is shown for a negative fee percentage",
      errors.some((n) => textOf(n).includes("between 0 and 100"))
    );
  }

  console.log("\n--- Non-admin session never renders the write form ---");
  {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ProjectPricingWorkspace, {
          projectId: "project-1",
          projectName: "Hawks Ridge Residence",
          isAdmin: false,
          feeTerms: NOT_DETERMINED,
          setFeeTerms: async () => {
            throw new Error("setFeeTerms must never be reachable from a non-admin render");
          },
          refreshFeeTerms: async () => ({ feeTerms: NOT_DETERMINED }),
        })
      );
    });

    check("no <form> is rendered for a non-admin session", renderer.root.findAllByType("form").length === 0);
    check(
      "a restricted-access note is shown instead",
      JSON.stringify(renderer.toJSON()).includes("Only an org admin can set or change")
    );
    check(
      "the read-only current-terms section still renders (the empty state)",
      JSON.stringify(renderer.toJSON()).includes("Not yet determined")
    );
  }

  console.log(`\nprojectPricingWorkspace.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
