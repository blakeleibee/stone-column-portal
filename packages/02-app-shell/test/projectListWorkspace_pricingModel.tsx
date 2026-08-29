/**
 * Regression coverage for ProjectListWorkspace.tsx's create-project form.
 *
 * HISTORY: this file used to cover Round 2/Task D2's pricing-model guard
 * (four unsupported PricingModel values disabled in a `<select>`, a
 * deleted fallback fee-basis picker). P3.1 Task 4 deleted the
 * project-number input, the "Suggest next number" button, and EVERY
 * pricing field from this form entirely — pricing now lives on Task 8's
 * own Contract & Pricing Terms screen (project_id/pricing route), reached
 * post-creation, not at create time. There is no PricingModel-related UI
 * left in this component to regress, so this file has been repurposed
 * (kept at its existing path/name — no other file references it by
 * content, only by filename in a couple of sibling test files' own
 * "same pattern as" comments) to cover P3.1-DESIGN.md §3's replacement
 * "progressive creation workflow" form instead: name/type/concept
 * required, address-or-"not established", the inline primary-homeowner
 * quick-add, and the optional staff picker — plus the create -> brief ->
 * contact -> switch -> redirect sequencing in handleCreateSubmit.
 *
 * This file has two layers, matching estimateTable_field_sync.tsx's own
 * precedent in this package:
 *   1. Source-level (fs.readFileSync) checks that the deleted
 *      project-number/pricing UI and helpers are actually gone from the
 *      source, not just unreachable, and that project type is now
 *      required (design §3, a real behavior change from pre-P3.1).
 *   2. react-test-renderer mount tests proving the live form: required-
 *      field validation (name/type/concept), the address/"not
 *      established" toggle, the primary-homeowner quick-add capturing
 *      locally and only reaching contactAction after createProject()
 *      succeeds, and that a follow-up (brief/contact) failure still lets
 *      the redirect through with a surfaced warning rather than losing
 *      the user's data or blocking navigation.
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
import type { CreateProjectParams } from "../src/services/projectService";
import type { ProjectContactInput, ProjectBriefWriteFields } from "../src/services/projectIntakeService";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

const SOURCE_PATH = path.join(__dirname, "../src/components/ProjectListWorkspace.tsx");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

// =====================================================================
// Source-level checks: project-number input/suggestion helper and every
// pricing field are actually deleted, not merely unreachable; project
// type is now a required field.
// =====================================================================
console.log("--- Source: project-number input and its suggestion helper are gone ---");
{
  check('no leftover "sc-proj-number" input id', !source.includes("sc-proj-number"));
  check("suggestNextProjectNumber() helper was removed, not left unused", !source.includes("suggestNextProjectNumber"));
  check('no leftover "Suggest next number" button copy', !source.includes("Suggest next number"));
  check("no leftover projectNumber state (setProjectNumber)", !source.includes("setProjectNumber"));
  check("no leftover allProjectNumbers prop", !source.includes("allProjectNumbers"));
}

console.log("\n--- Source: every pricing field is gone ---");
{
  check('no leftover "sc-proj-pricing" select id', !source.includes("sc-proj-pricing"));
  check('no leftover "sc-proj-pricing-label" input id', !source.includes("sc-proj-pricing-label"));
  check('no leftover "sc-proj-fee-pct" input id', !source.includes("sc-proj-fee-pct"));
  check('no leftover "sc-proj-fee-fixed" input id', !source.includes("sc-proj-fee-fixed"));
  check("PRICING_MODEL_OPTIONS constant was removed, not left unused", !source.includes("PRICING_MODEL_OPTIONS"));
  check("no leftover pricingModel state (setPricingModel)", !source.includes("setPricingModel"));
  check("no leftover feePercent/feeFixedDollars state", !source.includes("feePercent") && !source.includes("feeFixedDollars"));
  check("PricingModel/FeeBasis types are no longer imported", !/import type \{[^}]*\b(PricingModel|FeeBasis)\b/.test(source));
}

console.log("\n--- Source: the existing-client-login picker is gone from the create panel ---");
{
  check("no leftover clientOptions prop", !source.includes("clientOptions"));
  check("no leftover selectedClientIds state", !source.includes("selectedClientIds"));
  check('no leftover "Initial client contacts" copy', !source.includes("Initial client contacts"));
}

console.log("\n--- Source: the create panel mounts ProjectContactForm as a local capture, not a Server Action call ---");
{
  check("imports ProjectContactForm", source.includes("import { ProjectContactForm }"));
  check(
    "the quick-add's onSubmit captures into local state (setContactInput), not contactAction directly",
    /onSubmit=\{async \(input\) => \{\s*setContactInput\(input\)/.test(source)
  );
  check(
    "the quick-add passes renderAsForm={false} -- it is nested inside the outer sc-projects-form <form>, and a " +
      "<form> nested inside another <form> is invalid HTML (caused a real hydration mismatch)",
    /<ProjectContactForm[\s\S]{0,1200}renderAsForm=\{false\}/.test(source)
  );
}

// =====================================================================
// Integration (mounted) tests below, via react-test-renderer.
// =====================================================================
function findById(root: ReactTestInstance, id: string): ReactTestInstance {
  return root.findByProps({ id });
}

// react-test-renderer's `.props.children` on a mounted instance can contain
// circular _owner/FiberNode references, so JSON.stringify(...) on it throws
// -- `.children` (the RENDERED instance tree, no fiber backrefs) is the safe
// way to read text content. Same helper as projectContactsWorkspace.tsx's
// own copy in this package.
function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

/** Error/warning banners moved from this component's own one-off
 *  `sc-projects-error`/`sc-projects-warning` `<div>`s to the shared `ui/`
 *  `Alert` primitive (application-wide visual modernization) -- Alert
 *  renders `sc-ui-alert sc-ui-alert-<tone>` on the outer element and wraps
 *  its message in a nested `sc-ui-alert-body`, so callers need `textOf()`
 *  (not a direct `.children.join("")`) to read the message text. */
function findAlerts(root: ReactTestInstance, tone: "error" | "warning" | "info" | "success"): ReactTestInstance[] {
  return root.findAllByProps({ className: `sc-ui-alert sc-ui-alert-${tone}` });
}

function findFormByClassName(root: ReactTestInstance, className: string): ReactTestInstance {
  const forms = root.findAllByType("form").filter((f) => f.props.className === className);
  if (forms.length !== 1) throw new Error(`expected exactly one <form className="${className}">, found ${forms.length}`);
  return forms[0];
}

/** ProjectContactForm's inputs carry no `id` (see ProjectContactsWorkspace.tsx) —
 *  locate its "Full name" input by walking its labeled fields instead. */
function findContactFullNameInput(root: ReactTestInstance): ReactTestInstance {
  const labels = root.findAllByProps({ className: "sc-contact-field" });
  for (const label of labels) {
    const span = label.findByType("span");
    const text = Array.isArray(span.children) ? span.children.join("") : String(span.children);
    if (text === "Full name*") return label.findByType("input");
  }
  throw new Error("contact form's Full name input not found");
}

/** The inline quick-add's ProjectContactForm is mounted with
 *  `renderAsForm={false}` (nested inside the outer "sc-projects-form"
 *  <form> — a nested <form> is invalid HTML and was a real hydration
 *  bug, see ProjectContactForm's renderAsForm doc comment), so it
 *  renders a plain `<div className="sc-contact-form">`, not a `<form>`.
 *  Its "Save contact info" button is `type="button"` with an `onClick`
 *  that returns the same validation/onSubmit promise the standalone
 *  form's `onSubmit` handler would have run — await it directly rather
 *  than looking for a `<form>` to submit. */
async function submitInlineContactQuickAdd(root: ReactTestInstance) {
  const wrapper = root.findAllByProps({ className: "sc-contact-form" }).find((n) => n.type === "div");
  if (!wrapper) throw new Error('expected a <div className="sc-contact-form"> (renderAsForm=false)');
  const button = wrapper.findAllByType("button").find((b) => b.props.type === "button" && b.props.onClick);
  if (!button) throw new Error("inline contact quick-add's submit button not found");
  await act(async () => {
    await button.props.onClick();
  });
}

async function submitForm(form: ReactTestInstance) {
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} });
  });
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
  const briefCalls: { projectId: string; fields: ProjectBriefWriteFields }[] = [];
  const contactCalls: { projectId: string; contact: ProjectContactInput }[] = [];
  const props: ProjectListWorkspaceProps = {
    view: "active",
    projects: [],
    currentProjectId: null,
    orgId: "org-1",
    isAdmin: true,
    staffOptions: [],
    hasCompletedProjects: false,
    hasArchivedProjects: false,
    activeCount: 0,
    completedCount: 0,
    archivedCount: 0,
    initialCreateOpen: true,
    createProject: async (params) => {
      createProjectCalls.push(params);
      return { id: "new-project-id" };
    },
    switchProject: async () => ({ id: "new-project-id" }),
    briefAction: async (projectId, fields) => {
      briefCalls.push({ projectId, fields });
      return {};
    },
    contactAction: async (projectId, contact) => {
      contactCalls.push({ projectId, contact });
      return { id: "contact-1" };
    },
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
  return { renderer, router, createProjectCalls, briefCalls, contactCalls };
}

async function fillMinimumRequiredFields(renderer: TestRenderer.ReactTestRenderer, overrides: { name?: string; concept?: string } = {}) {
  act(() => {
    findById(renderer.root, "sc-proj-name").props.onChange({ target: { value: overrides.name ?? "Hawks Ridge Residence" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-type").props.onChange({ target: { value: "New Construction" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-concept").props.onChange({
      target: { value: overrides.concept ?? "A two-story remodel adding a primary suite and mudroom." },
    });
  });
}

async function main() {
console.log("\n--- Mounted: project type is a required field, not labeled optional (design §3) ---");
{
  const { renderer } = renderWorkspace();
  const typeSelect = findById(renderer.root, "sc-proj-type");
  check("the sc-proj-type <select> carries the required attribute", typeSelect.props.required === true);
  check(
    "the sc-proj-type <select> carries aria-required",
    typeSelect.props["aria-required"] === "true" || typeSelect.props["aria-required"] === true
  );
  const fieldLabels = renderer.root.findAllByProps({ className: "sc-ui-field-label" });
  const typeLabel = fieldLabels.find((l) => textOf(l).startsWith("Project type"));
  check("a 'Project type' field label is rendered", !!typeLabel);
  check('project type label no longer says "(optional)"', !!typeLabel && !textOf(typeLabel).includes("(optional)"));
}

console.log("\n--- Mounted: project name is required ---");
{
  const { renderer, createProjectCalls } = renderWorkspace();
  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);
  check("no createProject call with a blank name", createProjectCalls.length === 0);
  const errors = findAlerts(renderer.root, "error");
  check("a validation error is shown for a missing name", errors.some((n) => textOf(n).includes("Project name is required")));
}

console.log("\n--- Mounted: project type is required ---");
{
  const { renderer, createProjectCalls } = renderWorkspace();
  act(() => {
    findById(renderer.root, "sc-proj-name").props.onChange({ target: { value: "Test Project" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-concept").props.onChange({ target: { value: "A kitchen and primary bath remodel." } });
  });
  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);
  check("no createProject call with no project type selected", createProjectCalls.length === 0);
  const errors = findAlerts(renderer.root, "error");
  check("a validation error is shown for a missing project type", errors.some((n) => textOf(n).includes("Project type is required")));
}

console.log("\n--- Mounted: short project concept is required ---");
{
  const { renderer, createProjectCalls } = renderWorkspace();
  act(() => {
    findById(renderer.root, "sc-proj-name").props.onChange({ target: { value: "Test Project" } });
  });
  act(() => {
    findById(renderer.root, "sc-proj-type").props.onChange({ target: { value: "Remodel/Renovation" } });
  });
  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);
  check("no createProject call with no concept entered", createProjectCalls.length === 0);
  const errors = findAlerts(renderer.root, "error");
  check(
    "a validation error is shown for a missing project concept",
    errors.some((n) => textOf(n).includes("project concept is required"))
  );
}

console.log('\n--- Mounted: "Other" project type requires the free-text description ---');
{
  const { renderer, createProjectCalls } = renderWorkspace();
  await fillMinimumRequiredFields(renderer);
  act(() => {
    findById(renderer.root, "sc-proj-type").props.onChange({ target: { value: "Other" } });
  });
  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);
  check("no createProject call when Other is chosen with no description", createProjectCalls.length === 0);

  act(() => {
    findById(renderer.root, "sc-proj-type-other").props.onChange({ target: { value: "Detached studio" } });
  });
  await submitForm(form);
  check("createProject is called once the Other description is filled in", createProjectCalls.length === 1);
  check("projectType resolves to the free-text description", createProjectCalls[0].projectType === "Detached studio");
}

console.log('\n--- Mounted: "Address not established" toggle clears and disables the address field ---');
{
  const { renderer, createProjectCalls } = renderWorkspace();
  await fillMinimumRequiredFields(renderer);
  act(() => {
    findById(renderer.root, "sc-proj-address").props.onChange({ target: { value: "123 Ridge Rd" } });
  });
  check("address set", findById(renderer.root, "sc-proj-address").props.value === "123 Ridge Rd");

  act(() => {
    findById(renderer.root, "sc-proj-address-unestablished").props.onChange({ target: { checked: true } });
  });
  check("address is cleared once marked not established", findById(renderer.root, "sc-proj-address").props.value === "");
  check("address input is disabled once marked not established", findById(renderer.root, "sc-proj-address").props.disabled === true);

  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);
  check("createProject was called", createProjectCalls.length === 1);
  check("address is sent as null, not an empty string", createProjectCalls[0].address === null);
}

console.log("\n--- Mounted: a project is creatable with zero staff selections and no contact filled in ---");
{
  const { renderer, router, createProjectCalls, briefCalls, contactCalls } = renderWorkspace();
  await fillMinimumRequiredFields(renderer, { name: "No Staff No Contact Project" });

  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);

  check("createProject was called exactly once", createProjectCalls.length === 1);
  check("no pricing fields are sent at all", !("pricingModel" in createProjectCalls[0]) || createProjectCalls[0].pricingModel === undefined);
  check("no project number field is sent (server-generated)", !("projectNumber" in createProjectCalls[0]));
  check(
    "initialStaffProfileIds is an empty array, not omitted/undefined",
    Array.isArray(createProjectCalls[0].initialStaffProfileIds) && createProjectCalls[0].initialStaffProfileIds!.length === 0
  );
  check("the brief action is still called with the required concept text", briefCalls.length === 1 && briefCalls[0].projectId === "new-project-id");
  check("the contact action is NOT called when no contact was captured", contactCalls.length === 0);
  check(
    "after a successful create+switch, the workspace navigates to the new project's setup checklist",
    router.pushed.includes("/admin/projects/new-project-id/setup")
  );
}

console.log("\n--- Mounted: filling in the inline primary-homeowner quick-add captures locally, then reaches contactAction only after createProject() succeeds ---");
{
  const { renderer, contactCalls, createProjectCalls } = renderWorkspace();
  await fillMinimumRequiredFields(renderer, { name: "Contact Quick-Add Project" });

  const contactNameInput = findContactFullNameInput(renderer.root);
  act(() => {
    contactNameInput.props.onChange({ target: { value: "Jane Homeowner" } });
  });
  await submitInlineContactQuickAdd(renderer.root);

  check("contactAction is not called yet -- the project doesn't exist until the outer form submits", contactCalls.length === 0);
  check(
    "the captured contact's name now appears as a summary in the create panel",
    renderer.root.findAllByProps({ className: "sc-projects-contact-summary" }).length === 1
  );

  const outerForm = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(outerForm);

  check("createProject was called exactly once", createProjectCalls.length === 1);
  check("contactAction was called exactly once, after createProject resolved", contactCalls.length === 1);
  check("contactAction received the new project's id", contactCalls[0].projectId === "new-project-id");
  check("contactAction received the captured full name", contactCalls[0].contact.fullName === "Jane Homeowner");
  check("the quick-add defaults the role to primary_homeowner", contactCalls[0].contact.role === "primary_homeowner");
}

console.log("\n--- Mounted: a failed brief/contact follow-up surfaces a warning but still redirects (project already exists) ---");
{
  const { renderer, router, createProjectCalls } = renderWorkspace({
    briefAction: async () => ({ error: "database is unavailable" }),
  });
  await fillMinimumRequiredFields(renderer, { name: "Follow-Up Failure Project" });

  const form = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(form);

  check("createProject still succeeded", createProjectCalls.length === 1);
  check(
    "the redirect to the setup checklist still fires despite the brief-save failure",
    router.pushed.includes("/admin/projects/new-project-id/setup")
  );
  const warnings = findAlerts(renderer.root, "warning");
  check(
    "a warning banner surfaces the follow-up failure instead of silently dropping it",
    warnings.some((n) => textOf(n).includes("database is unavailable"))
  );
}

console.log("\n--- Mounted: if createProject() itself fails, neither follow-up is attempted ---");
{
  const { renderer, briefCalls, contactCalls } = renderWorkspace({
    createProject: async () => ({ error: "org admin required" }),
  });
  await fillMinimumRequiredFields(renderer, { name: "Create Failure Project" });

  const contactNameInput = findContactFullNameInput(renderer.root);
  act(() => {
    contactNameInput.props.onChange({ target: { value: "Jane Homeowner" } });
  });
  await submitInlineContactQuickAdd(renderer.root);

  const outerForm = findFormByClassName(renderer.root, "sc-projects-form");
  await submitForm(outerForm);

  check("the brief action was never called when createProject failed", briefCalls.length === 0);
  check("the contact action was never called when createProject failed", contactCalls.length === 0);
  const errors = findAlerts(renderer.root, "error");
  check("createProject's own error is surfaced", errors.some((n) => textOf(n).includes("org admin required")));
}

console.log(`\nprojectListWorkspace_pricingModel.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
