/**
 * Round 2, Task D2 (owner preview) regression coverage for
 * ProjectListWorkspace.tsx's create-project form.
 *
 * BACKGROUND: `project_fee_rules` / `create_project_with_defaults()`
 * (schema/001, schema/016) can only genuinely represent a cost-plus
 * builder fee (percentage-of-cost or flat-dollar-on-top-of-cost). The
 * create form's `pricingModel` selector used to offer four OTHER
 * options (`fixed_price`, `time_and_materials`, `hybrid_custom`,
 * `other`) that fell back to that same fee-basis picker, which risked
 * storing a number that looks like a real fee but doesn't mean what
 * fee_basis/fee_basis_points normally mean for those contract types.
 * The fix disables those four options (visible, labeled "Coming
 * later") and deletes the fallback picker entirely.
 *
 * This file has two layers, matching estimateTable_field_sync.tsx's own
 * precedent in this package:
 *   1. Source-level (fs.readFileSync) checks that the four unsupported
 *      models are actually disabled and the fallback UI/state is
 *      actually gone from the source, not just unreachable.
 *   2. react-test-renderer mount tests proving the live form: (a) the
 *      rendered <option> elements match the disabled/label contract,
 *      (b) unrelated field state survives a pricingModel/projectType
 *      change (owner verification item 1), (c) the fee-percentage
 *      input rejects negative and out-of-range values instead of
 *      silently accepting them (owner verification item 2), and (d) a
 *      project is creatable with zero staff and zero client selections
 *      (owner verification item 3).
 *
 * next/navigation's useRouter() throws immediately
 * ("invariant expected app router to be mounted") unless a real
 * AppRouterContext.Provider is present -- there is no existing
 * precedent in this package for mounting a component that calls
 * useRouter(), so this file wraps the component under test in that
 * context directly (imported from Next's own shared-runtime module,
 * not reimplemented) rather than skip integration coverage entirely.
 *
 * Run with `npx tsx test/projectListWorkspace_pricingModel.tsx`.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ProjectListWorkspace, type ProjectListWorkspaceProps } from "../src/components/ProjectListWorkspace";
import type { CreateProjectParams, PricingModel } from "../src/services/projectService";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

const SOURCE_PATH = path.join(__dirname, "../src/components/ProjectListWorkspace.tsx");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

// =====================================================================
// Source-level checks: the four unsupported models are disabled +
// labeled "Coming later", the two cost-plus models are not, and the
// fallback fee-basis picker (and the state it existed only to feed) is
// actually deleted, not merely unreachable.
// =====================================================================
console.log("--- Source: PRICING_MODEL_OPTIONS disables exactly the four unsupported models ---");
{
  const optionsStart = source.indexOf("const PRICING_MODEL_OPTIONS");
  const optionsEnd = source.indexOf("];", optionsStart);
  check("found PRICING_MODEL_OPTIONS", optionsStart !== -1 && optionsEnd !== -1);
  const optionsSource = source.slice(optionsStart, optionsEnd);

  for (const disabledModel of ["fixed_price", "time_and_materials", "hybrid_custom", "other"] as const) {
    const lineMatch = optionsSource.match(new RegExp(`\\{[^}]*value:\\s*"${disabledModel}"[^}]*\\}`));
    check(`${disabledModel}'s option entry exists`, !!lineMatch);
    const entry = lineMatch ? lineMatch[0] : "";
    check(`${disabledModel} is marked disabled: true`, /disabled:\s*true/.test(entry));
    check(`${disabledModel}'s label says "Coming later"`, /\(Coming later\)/.test(entry));
  }

  for (const selectableModel of ["cost_plus_percentage", "cost_plus_fixed_fee"] as const) {
    const lineMatch = optionsSource.match(new RegExp(`\\{[^}]*value:\\s*"${selectableModel}"[^}]*\\}`));
    check(`${selectableModel}'s option entry exists`, !!lineMatch);
    const entry = lineMatch ? lineMatch[0] : "";
    check(`${selectableModel} is NOT marked disabled`, !/disabled:\s*true/.test(entry));
    check(`${selectableModel}'s label does not say "Coming later"`, !/\(Coming later\)/.test(entry));
  }
}

console.log("\n--- Source: the <select>'s options actually forward `disabled` to the DOM <option> ---");
{
  check(
    "the PRICING_MODEL_OPTIONS.map(...) call passes disabled={opt.disabled} to <option>",
    /PRICING_MODEL_OPTIONS\.map[\s\S]{0,200}disabled=\{opt\.disabled\}/.test(source)
  );
}

console.log("\n--- Source: the fallback fee-basis picker is deleted, not just unreachable ---");
{
  check('no leftover "sc-proj-fee-basis" fallback select id', !source.includes("sc-proj-fee-basis"));
  check('no leftover "sc-proj-fee-pct-fallback" input id', !source.includes("sc-proj-fee-pct-fallback"));
  check('no leftover "sc-proj-fee-fixed-fallback" input id', !source.includes("sc-proj-fee-fixed-fallback"));
  check('no leftover "sc-projects-fee-fallback" CSS class', !source.includes("sc-projects-fee-fallback"));
  check(
    'no leftover "Detailed pricing capture for this contract type" disclosure copy',
    !source.includes("Detailed pricing capture for this contract type")
  );
  check("the now-dead pricingModelImpliesFeeBasis() helper was removed, not left unused", !source.includes("pricingModelImpliesFeeBasis"));
  check("the feeBasis fallback state (setFeeBasis) was removed, not left unused", !source.includes("setFeeBasis"));
}

console.log("\n--- Source: the create form's pricingModel state still defaults to a selectable model ---");
{
  check(
    'useState<PricingModel> default is "cost_plus_percentage"',
    /useState<PricingModel>\("cost_plus_percentage"\)/.test(source)
  );
}

// =====================================================================
// Integration (mounted) tests below, via react-test-renderer.
// =====================================================================
function findById(root: ReactTestInstance, id: string): ReactTestInstance {
  return root.findByProps({ id });
}

function mockRouter(): AppRouterInstance & { pushed: string[]; refreshed: number } {
  const calls = { pushed: [] as string[], refreshed: 0 };
  return {
    back() {},
    forward() {},
    refresh() {
      calls.refreshed++;
    },
    push(href: string) {
      calls.pushed.push(href);
    },
    replace() {},
    prefetch() {},
    get pushed() {
      return calls.pushed;
    },
    get refreshed() {
      return calls.refreshed;
    },
  };
}

function renderWorkspace(overrides: Partial<ProjectListWorkspaceProps> = {}) {
  const router = mockRouter();
  const createProjectCalls: CreateProjectParams[] = [];
  const props: ProjectListWorkspaceProps = {
    view: "active",
    projects: [],
    currentProjectId: null,
    orgId: "org-1",
    isAdmin: true,
    staffOptions: [],
    clientOptions: [],
    allProjectNumbers: [],
    hasCompletedProjects: false,
    hasArchivedProjects: false,
    initialCreateOpen: true,
    createProject: async (params) => {
      createProjectCalls.push(params);
      return { id: "new-project-id" };
    },
    switchProject: async () => ({ id: "new-project-id" }),
    changeProjectStatus: async () => ({}),
    activeProjectsHref: "/admin/projects",
    completedProjectsHref: "/admin/projects/completed",
    archivedProjectsHref: "/admin/projects/archived",
    ...overrides,
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(
        AppRouterContext.Provider,
        { value: router },
        React.createElement(ProjectListWorkspace, props)
      )
    );
  });
  return { renderer, router, createProjectCalls };
}

async function main() {
console.log("\n--- Mounted: pricing-model <select> renders exactly the expected disabled/enabled options ---");
{
  const { renderer } = renderWorkspace();
  const select = findById(renderer.root, "sc-proj-pricing");
  const options = select.findAllByType("option");
  check("renders all 6 pricing-model options", options.length === 6);

  const expectedDisabled: Record<string, boolean> = {
    cost_plus_percentage: false,
    cost_plus_fixed_fee: false,
    fixed_price: true,
    time_and_materials: true,
    hybrid_custom: true,
    other: true,
  };
  for (const opt of options) {
    const value = opt.props.value as string;
    check(
      `<option value="${value}"> has disabled=${expectedDisabled[value]}`,
      Boolean(opt.props.disabled) === expectedDisabled[value]
    );
  }
  check("select's initial value is the selectable cost_plus_percentage default", select.props.value === "cost_plus_percentage");
}

console.log("\n--- Mounted: verification item 1 — changing pricingModel/projectType never clobbers other fields ---");
{
  const { renderer } = renderWorkspace();
  const nameInput = findById(renderer.root, "sc-proj-name");
  const numberInput = findById(renderer.root, "sc-proj-number");
  const addressInput = findById(renderer.root, "sc-proj-address");

  act(() => {
    nameInput.props.onChange({ target: { value: "Hawks Ridge Residence" } });
  });
  act(() => {
    numberInput.props.onChange({ target: { value: "PRJ-1042" } });
  });
  act(() => {
    addressInput.props.onChange({ target: { value: "123 Ridge Rd" } });
  });
  check("name set", findById(renderer.root, "sc-proj-name").props.value === "Hawks Ridge Residence");
  check("number set", findById(renderer.root, "sc-proj-number").props.value === "PRJ-1042");
  check("address set", findById(renderer.root, "sc-proj-address").props.value === "123 Ridge Rd");

  // Switch pricing model to the other selectable option.
  act(() => {
    findById(renderer.root, "sc-proj-pricing").props.onChange({ target: { value: "cost_plus_fixed_fee" as PricingModel } });
  });
  check(
    "name survives a pricingModel change",
    findById(renderer.root, "sc-proj-name").props.value === "Hawks Ridge Residence"
  );
  check(
    "project number survives a pricingModel change",
    findById(renderer.root, "sc-proj-number").props.value === "PRJ-1042"
  );
  check(
    "address survives a pricingModel change",
    findById(renderer.root, "sc-proj-address").props.value === "123 Ridge Rd"
  );
  check(
    "the fixed-fee input is now shown instead of the percentage input",
    renderer.root.findAllByProps({ id: "sc-proj-fee-fixed" }).length === 1 &&
      renderer.root.findAllByProps({ id: "sc-proj-fee-pct" }).length === 0
  );

  // Change project type too — must not disturb the pricing model or the
  // other already-entered fields either.
  act(() => {
    findById(renderer.root, "sc-proj-type").props.onChange({ target: { value: "Remodel/Renovation" } });
  });
  check("name survives a projectType change", findById(renderer.root, "sc-proj-name").props.value === "Hawks Ridge Residence");
  check(
    "pricingModel survives a projectType change",
    findById(renderer.root, "sc-proj-pricing").props.value === "cost_plus_fixed_fee"
  );
}

console.log("\n--- Mounted: verification item 2 — fee percentage rejects negative and out-of-range values ---");
{
  const { renderer, createProjectCalls } = renderWorkspace();
  act(() => {
    findById(renderer.root, "sc-proj-name").props.onChange({ target: { value: "Test Project" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-number").props.onChange({ target: { value: "1001" } });
  });

  async function submitWithPercent(pct: string) {
    act(() => {
      findById(renderer.root, "sc-proj-fee-pct").props.onChange({ target: { value: pct } });
    });
    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });
  }

  await submitWithPercent("-5");
  check("a negative fee percentage is rejected (no createProject call)", createProjectCalls.length === 0);
  const errorAfterNegative = renderer.root.findAllByProps({ className: "sc-projects-error" });
  check(
    "a validation error is shown for a negative fee percentage",
    errorAfterNegative.some((n) => String(n.children.join("")).includes("between 0 and 100"))
  );

  await submitWithPercent("150");
  check("an out-of-range (>100) fee percentage is rejected (still no createProject call)", createProjectCalls.length === 0);

  await submitWithPercent("15");
  check("a valid fee percentage is accepted", createProjectCalls.length === 1);
  check("feeBasisPoints is correctly converted to basis points (15% -> 1500)", createProjectCalls[0].feeBasisPoints === 1500);
  check("feeFixedAmountCents is null for a percentage-basis project", createProjectCalls[0].feeFixedAmountCents === null);
}

console.log("\n--- Mounted: verification item 3 — a project is creatable with zero staff and zero client selections ---");
{
  const { renderer, router, createProjectCalls } = renderWorkspace();
  act(() => {
    findById(renderer.root, "sc-proj-name").props.onChange({ target: { value: "No Staff No Client Project" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-number").props.onChange({ target: { value: "2002" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-fee-pct").props.onChange({ target: { value: "12" } });
  });

  const form = renderer.root.findByType("form");
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} });
  });

  check("createProject was called exactly once", createProjectCalls.length === 1);
  check("initialStaffProfileIds is an empty array, not omitted/undefined", Array.isArray(createProjectCalls[0].initialStaffProfileIds) && createProjectCalls[0].initialStaffProfileIds!.length === 0);
  check(
    "initialClientProfileIds is an empty array, not omitted/undefined",
    Array.isArray(createProjectCalls[0].initialClientProfileIds) && createProjectCalls[0].initialClientProfileIds!.length === 0
  );
  check("after a successful create+switch, the workspace navigates to the new project's setup checklist", router.pushed.includes("/admin/projects/new-project-id/setup"));
}

console.log(`\nprojectListWorkspace_pricingModel.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
