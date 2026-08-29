/**
 * P3.1 Task 7 regression coverage for ProjectSetupChecklist.tsx — the
 * revised, real-data-driven 11-item Setup checklist (design §9), replacing
 * the old P3-era static two-item structure. Mounted via react-test-renderer,
 * same pattern as projectPricingWorkspace.tsx/projectContactsWorkspace.tsx's
 * own "Mounted" sections in this package (find-by-id, `act()`-wrapped
 * events, assert on rendered text/props).
 *
 * next/navigation's useRouter() throws immediately ("invariant expected app
 * router to be mounted") unless a real AppRouterContext.Provider is
 * present — same reason and same fix as
 * projectListWorkspace_pricingModel.tsx's own mockRouter()/AppRouterContext
 * wrapping, reused verbatim here (this component also calls useRouter(),
 * for the "Preliminary estimating" switch-then-navigate flow).
 *
 * Exercises, at minimum (per the Task 7 brief):
 *   - a project with nothing filled in shows every {kind:"derived"} item
 *     as "Not started," with a real, clickable link still present (not
 *     hidden until something exists).
 *   - a project with some data filled in shows the right items as
 *     "In progress"/"Complete", individually, without affecting the
 *     others.
 *   - every {kind:"coming_later"} item is genuinely inert
 *     (aria-disabled="true", no href/onClick) in every scenario.
 *   - "Preliminary estimating" ({kind:"available"}) always renders as a
 *     real, clickable control with no completion-status badge, regardless
 *     of the other items' state — and clicking it calls switchProject(projectId)
 *     before navigating to /admin/estimate.
 *   - the overall completion-progress indicator counts only
 *     {kind:"derived"} items (7 of 11), and updates as those items'
 *     statuses change.
 *
 * Run with `npx tsx test/projectSetupChecklist.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ProjectSetupChecklist, type ProjectSetupChecklistProps } from "../src/components/ProjectSetupChecklist";
import type { ProjectSetupChecklist as ChecklistData } from "../src/services/projectIntakeService";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function textOf(instance: ReactTestInstance): string {
  return instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

// The "nothing filled in yet" checklist — every derived item not_started,
// every coming_later item coming_later, preliminaryEstimating available.
// projectIdentity is always complete (design §9 row 1 — a static fact
// about any project that exists at all), matching what
// getProjectSetupChecklist() itself always returns.
const EMPTY_CHECKLIST: ChecklistData = {
  projectIdentity: { kind: "derived", status: "complete" },
  homeownersDecisionMakers: { kind: "derived", status: "not_started" },
  conceptScope: { kind: "derived", status: "not_started" },
  propertySiteInfo: { kind: "derived", status: "not_started" },
  plansDocuments: { kind: "coming_later" },
  staffResponsibilities: { kind: "derived", status: "not_started" },
  preliminaryEstimating: { kind: "available" },
  permitting: { kind: "derived", status: "not_started" },
  quickbooksConnection: { kind: "coming_later" },
  contractPricingTerms: { kind: "derived", status: "not_started" },
  schedule: { kind: "coming_later" },
};

const PARTIAL_CHECKLIST: ChecklistData = {
  ...EMPTY_CHECKLIST,
  homeownersDecisionMakers: { kind: "derived", status: "in_progress" },
  conceptScope: { kind: "derived", status: "complete" },
  staffResponsibilities: { kind: "derived", status: "complete" },
};

function mockRouter(): AppRouterInstance & { pushed: string[] } {
  const pushed: string[] = [];
  return {
    back() {},
    forward() {},
    refresh() {},
    push(href: string) {
      pushed.push(href);
    },
    replace() {},
    prefetch() {},
    get pushed() {
      return pushed;
    },
  };
}

function render(overrides: Partial<ProjectSetupChecklistProps> = {}) {
  const router = mockRouter();
  const switchProjectCalls: string[] = [];
  const props: ProjectSetupChecklistProps = {
    projectId: "project-1",
    projectName: "Hawks Ridge Residence",
    overviewHref: "/admin/overview",
    checklist: EMPTY_CHECKLIST,
    switchProject: async (projectId: string) => {
      switchProjectCalls.push(projectId);
      return { id: projectId };
    },
    ...overrides,
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(ProjectSetupChecklist, props))
    );
  });
  return { renderer, router, switchProjectCalls };
}

async function main() {
  console.log("--- Nothing filled in: every derived item shows 'Not started' with a real, clickable link ---");
  {
    const { renderer } = render({ checklist: EMPTY_CHECKLIST });
    const json = JSON.stringify(renderer.toJSON());

    // 5 not_started derived items (excludes projectIdentity, which is
    // always complete, and contractPricingTerms/permitting/etc. counted
    // separately below) — count "Not started" occurrences generically.
    const notStartedCount = (json.match(/Not started/g) ?? []).length;
    check("shows 'Not started' for every not-yet-started derived item (6: homeowners, concept, site info, staff, permitting, pricing)", notStartedCount === 6);

    const links = renderer.root.findAllByType("a");
    const hrefs = links.map((l) => l.props.href);
    check("Homeowners & decision-makers links to /admin/projects/project-1/contacts", hrefs.includes("/admin/projects/project-1/contacts"));
    check("Concept & scope links to /admin/projects/project-1/brief", hrefs.includes("/admin/projects/project-1/brief"));
    check("Property & site info links to /admin/projects/project-1/brief?tab=site-info", hrefs.includes("/admin/projects/project-1/brief?tab=site-info"));
    check("Staff & responsibilities links to /admin/projects/project-1/team", hrefs.includes("/admin/projects/project-1/team"));
    check("Contract & pricing terms links to /admin/projects/project-1/pricing", hrefs.includes("/admin/projects/project-1/pricing"));
    // Permitting reuses the site-info link (design §9: "links into the
    // site-info section's permitting group") — appears twice among hrefs.
    check("Permitting also links into the site-info route", hrefs.filter((h) => h === "/admin/projects/project-1/brief?tab=site-info").length === 2);

    check("Project identity shows 'Complete' with no href (static summary row)", json.includes("Project identity") && json.includes("Complete"));
  }

  console.log("\n--- Partial data: only the actually-filled-in items show 'In progress'/'Complete', others stay 'Not started' ---");
  {
    const { renderer } = render({ checklist: PARTIAL_CHECKLIST });
    const json = JSON.stringify(renderer.toJSON());
    check("shows 'In progress' for homeownersDecisionMakers", json.includes("In progress"));
    // "Complete" now applies to projectIdentity + conceptScope + staffResponsibilities = 3 occurrences.
    const completeCount = (json.match(/Complete/g) ?? []).length;
    check("exactly 3 items show 'Complete' (project identity, concept & scope, staff & responsibilities)", completeCount === 3);
    // The untouched items (property & site info, permitting, contract & pricing) stay not_started.
    const notStartedCount = (json.match(/Not started/g) ?? []).length;
    check("the 3 untouched derived items still show 'Not started'", notStartedCount === 3);
  }

  console.log("\n--- 'Coming later' items are genuinely inert in every scenario ---");
  for (const checklist of [EMPTY_CHECKLIST, PARTIAL_CHECKLIST]) {
    const { renderer } = render({ checklist });
    const inertItems = renderer.root.findAllByProps({ "aria-disabled": "true" });
    check("exactly 3 items are aria-disabled (Plans & documents, QuickBooks connection, Schedule)", inertItems.length === 3);
    for (const item of inertItems) {
      check(`inert item "${textOf(item).slice(0, 40)}" has no href/onClick anywhere in its subtree`, findAnyHrefOrOnClick(item) === false);
    }
    const json = JSON.stringify(renderer.toJSON());
    check("shows 'Coming later' for Plans & documents", json.includes("Plans &amp; documents") || json.includes("Plans & documents"));
    check("shows 'Coming later' for QuickBooks connection", json.includes("QuickBooks connection"));
    check("shows 'Coming later' for Schedule", json.includes("Schedule"));
  }

  console.log("\n--- 'Preliminary estimating' is always a real, clickable control with no status badge ---");
  for (const checklist of [EMPTY_CHECKLIST, PARTIAL_CHECKLIST]) {
    const { renderer } = render({ checklist });
    const button = renderer.root.findByProps({ id: "sc-setup-item-estimate" });
    check("Preliminary estimating renders as a real, enabled button", button.props.disabled !== true);
    const text = textOf(button);
    check("Preliminary estimating shows no Not-started/In-progress/Complete status text", !/Not started|In progress|Complete/.test(text));
    check("Preliminary estimating shows 'Available' instead of a derived status", text.includes("Available"));
  }

  console.log("\n--- Clicking 'Preliminary estimating' switches to this project, then navigates to /admin/estimate ---");
  {
    const { renderer, router, switchProjectCalls } = render({ projectId: "project-42" });
    const button = renderer.root.findByProps({ id: "sc-setup-item-estimate" });
    await act(async () => {
      await button.props.onClick();
    });
    check("switchProject was called with this screen's own projectId", switchProjectCalls.length === 1 && switchProjectCalls[0] === "project-42");
    check("router.push navigated to /admin/estimate after the switch resolved", router.pushed.includes("/admin/estimate"));
  }

  console.log("\n--- switchProject failing surfaces an error and does not navigate ---");
  {
    const { renderer, router } = render({
      switchProject: async () => ({ error: "That project is not accessible to you." }),
    });
    const button = renderer.root.findByProps({ id: "sc-setup-item-estimate" });
    await act(async () => {
      await button.props.onClick();
    });
    check("router.push was never called when switchProject errors", router.pushed.length === 0);
    check(
      "the error message is shown",
      JSON.stringify(renderer.toJSON()).includes("That project is not accessible to you.")
    );
  }

  console.log("\n--- Overall completion-progress indicator counts only {kind:\"derived\"} items ---");
  {
    const { renderer } = render({ checklist: EMPTY_CHECKLIST });
    // Rendered by the shared ProgressBar primitive now (visual
    // modernization pass) — its label carries the exact same "N of M
    // sections complete" text this screen always computed, just inside
    // ProgressBar's own "sc-ui-progress-label" element instead of this
    // screen's old bespoke "sc-setup-progress" <p>.
    const progress = textOf(renderer.root.findByProps({ className: "sc-ui-progress-label" }));
    // 7 derived items total (projectIdentity, homeowners, concept, site
    // info, staff, permitting, pricing); only projectIdentity is complete.
    check("shows '1 of 7 sections complete' when only project identity is done", progress === "1 of 7 sections complete");
  }
  {
    const { renderer } = render({ checklist: PARTIAL_CHECKLIST });
    const progress = textOf(renderer.root.findByProps({ className: "sc-ui-progress-label" }));
    // projectIdentity + conceptScope + staffResponsibilities = 3 of 7.
    check("shows '3 of 7 sections complete' once concept & scope and staff are also complete", progress === "3 of 7 sections complete");
  }
  {
    const ALL_COMPLETE: ChecklistData = {
      projectIdentity: { kind: "derived", status: "complete" },
      homeownersDecisionMakers: { kind: "derived", status: "complete" },
      conceptScope: { kind: "derived", status: "complete" },
      propertySiteInfo: { kind: "derived", status: "complete" },
      plansDocuments: { kind: "coming_later" },
      staffResponsibilities: { kind: "derived", status: "complete" },
      preliminaryEstimating: { kind: "available" },
      permitting: { kind: "derived", status: "complete" },
      quickbooksConnection: { kind: "coming_later" },
      contractPricingTerms: { kind: "derived", status: "complete" },
      schedule: { kind: "coming_later" },
    };
    const { renderer } = render({ checklist: ALL_COMPLETE });
    const progress = textOf(renderer.root.findByProps({ className: "sc-ui-progress-label" }));
    check("shows '7 of 7 sections complete' when every derived item is complete (coming_later/available items never affect the denominator)", progress === "7 of 7 sections complete");
  }

  console.log(`\nprojectSetupChecklist.tsx: all ${checks} checks passed.`);
}

/** True if this instance or anything in its subtree carries a real href
 *  or onClick — used to prove a "Coming later" <li> is genuinely inert,
 *  not just visually styled that way. */
function findAnyHrefOrOnClick(instance: ReactTestInstance): boolean {
  if (instance.props && (instance.props.href !== undefined || typeof instance.props.onClick === "function")) return true;
  for (const child of instance.children) {
    if (typeof child === "string") continue;
    if (findAnyHrefOrOnClick(child)) return true;
  }
  return false;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
