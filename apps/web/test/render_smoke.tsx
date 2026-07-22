/**
 * Executable test for the preview app. Run with `npx tsx test/render_smoke.tsx`.
 *
 * DISCLOSED LIMITATION: App.tsx's top-level loading (useEffect + async
 * view-model building) can't be exercised via `renderToStaticMarkup` —
 * SSR doesn't run effects at all (that's standard React behavior, not
 * a gap specific to this sandbox), so a direct `<App />` render would
 * only ever show the "Loading sample data…" state. To actually test
 * the real content, this file builds the view models directly (the
 * same functions App.tsx calls) and renders `AdminContent`/
 * `ClientContent` — the same components App.tsx uses internally,
 * exported specifically for this purpose — for every possible active
 * key, plus the individual demo-only components (DemoControls,
 * AdminOverviewScreen, ProjectWorkspace, ClientHomeScreen).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FixtureFinancialRepository } from "../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { buildAdminFinancialsViewModel } from "../../../packages/02-app-shell/src/viewmodels/buildAdminFinancialsViewModel";
import { buildClientBudgetViewModel } from "../../../packages/02-app-shell/src/viewmodels/buildClientBudgetViewModel";
import { formatCents } from "../../../packages/01-financial-engine/src/money";
import { projectMeta } from "../../../packages/01-financial-engine/fixtures/hawksRidge";
import { AppShell } from "../../../packages/02-app-shell/src/components/AppShell";
import { AdminContent, ClientContent, type AdminActiveKey, type ClientActiveKey } from "../src/App";
import { DemoControls } from "../src/demo/DemoControls";
import { AdminOverviewScreen } from "../src/screens/AdminOverviewScreen";
import { ProjectWorkspace, type ProjectTab } from "../src/screens/ProjectWorkspace";
import { ClientHomeScreen } from "../src/screens/ClientHomeScreen";
import { SampleDataTag } from "../src/components/SampleDataTag";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

async function main() {
  const repo = new FixtureFinancialRepository();
  const adminVM = await buildAdminFinancialsViewModel(projectMeta.id, repo);
  const clientVM = await buildClientBudgetViewModel(projectMeta.id, repo);

  console.log("--- Every admin active key renders without throwing ---");
  const adminKeys: AdminActiveKey[] = ["overview", "projects", "action-center", "financials", "conversations", "contacts", "settings"];
  for (const key of adminKeys) {
    const html = renderToStaticMarkup(<AdminContent activeKey={key} adminVM={adminVM} onOpenProject={() => {}} />);
    check(`admin activeKey="${key}" renders non-empty content`, html.length > 20);
  }

  console.log("\n--- Every client active key renders without throwing ---");
  const clientKeys: ClientActiveKey[] = ["home", "budget", "schedule", "selections", "messages", "updates", "documents"];
  for (const key of clientKeys) {
    const html = renderToStaticMarkup(<ClientContent activeKey={key} clientVM={clientVM} onGoToBudget={() => {}} />);
    check(`client activeKey="${key}" renders non-empty content`, html.length > 20);
  }

  console.log("\n--- Financials tab uses the real engine, not a hardcoded figure ---");
  const financialsHtml = renderToStaticMarkup(<AdminContent activeKey="financials" adminVM={adminVM} onOpenProject={() => {}} />);
  check(
    "admin Financials shows the engine's actual revised-estimate figure",
    financialsHtml.includes(formatCents(adminVM.totals.revisedEstimateCents))
  );
  const budgetHtml = renderToStaticMarkup(<ClientContent activeKey="budget" clientVM={clientVM} onGoToBudget={() => {}} />);
  check(
    "client Budget shows the client-safe view model's actual revised-estimate figure",
    budgetHtml.includes(formatCents(clientVM.totals.revisedEstimateCents))
  );
  check(
    "client Budget screen does NOT show the admin-only fee-accrued figure",
    !budgetHtml.includes(formatCents(adminVM.feeSummary.feeAccruedCents))
  );

  console.log("\n--- Placeholder/preview screens are clearly labeled, not silently blank ---");
  // Two labeling conventions now coexist, both legitimate: genuinely
  // still-blank screens (Settings) use PlaceholderScreen's "Preview
  // only"; screens restored with rich original-prototype sample content
  // (Action Center, Conversations, Contacts, Schedule, Selections,
  // Documents, Updates & Photos) use "Preview content — <package>" tags
  // instead, since they're no longer blank pages.
  const isLabeledAsPreview = (html: string) => html.includes("Preview only") || html.includes("Preview content");

  for (const key of ["action-center", "conversations", "contacts", "settings"] as const) {
    const html = renderToStaticMarkup(<AdminContent activeKey={key} adminVM={adminVM} onOpenProject={() => {}} />);
    check(`admin "${key}" screen is labeled as preview content`, isLabeledAsPreview(html));
  }
  // Client-side placeholders similarly.
  for (const key of ["schedule", "selections", "messages", "updates", "documents"] as const) {
    const html = renderToStaticMarkup(<ClientContent activeKey={key} clientVM={clientVM} onGoToBudget={() => {}} />);
    check(`client "${key}" screen is labeled as preview content`, isLabeledAsPreview(html));
  }

  console.log("\n--- Project workspace: internal tabs (Schedule/Selections/Documents/Updates), no AppShell changes needed ---");
  const workspaceHtml = renderToStaticMarkup(<ProjectWorkspace adminViewModel={adminVM} />);
  check("workspace renders the project name", workspaceHtml.includes(projectMeta.name));
  check(
    "workspace renders all its internal tabs",
    ["Overview", "Financials", "Schedule", "Selections", "Documents", "Conversations"].every((label) =>
      workspaceHtml.includes(`>${label}<`)
    ) && workspaceHtml.includes(">Updates &amp; Photos<")
  );
  check(
    "workspace defaults to its own 'overview' tab, itself clearly labeled as preview content (Package 3 scope, not yet built)",
    isLabeledAsPreview(workspaceHtml)
  );

  const workspaceTabExpectations: Array<[ProjectTab, string]> = [
    ["schedule", "Schedule"],
    ["selections", "Selections"],
    ["documents", "Documents"],
    ["updates", "Updates &amp; Photos"],
    ["conversations", "Conversations"],
  ];
  for (const [tabKey, expectedTitle] of workspaceTabExpectations) {
    const tabHtml = renderToStaticMarkup(
      <ProjectWorkspace adminViewModel={adminVM} initialTab={tabKey} />
    );
    check(`workspace "${tabKey}" tab shows labeled preview content`, isLabeledAsPreview(tabHtml) && tabHtml.includes(expectedTitle));
  }
  const workspaceFinancialsHtml = renderToStaticMarkup(<ProjectWorkspace adminViewModel={adminVM} initialTab="financials" />);
  check(
    "workspace 'financials' tab shows the REAL engine figure, not a preview placeholder",
    workspaceFinancialsHtml.includes(formatCents(adminVM.totals.revisedEstimateCents)) && !isLabeledAsPreview(workspaceFinancialsHtml)
  );

  console.log("\n--- Demo controls render both roles + preview button ---");
  const demoHtml = renderToStaticMarkup(
    <DemoControls role="admin" onChangeRole={() => {}} isPreviewingAsClient={false} onPreviewAsClient={() => {}} />
  );
  check("demo controls are labeled as demo-only", demoHtml.includes("DEMO CONTROLS"));
  check("demo controls show a Preview as Client button for admin", demoHtml.includes("Preview as Client"));

  const demoPreviewingHtml = renderToStaticMarkup(
    <DemoControls role="admin" onChangeRole={() => {}} isPreviewingAsClient={true} onPreviewAsClient={() => {}} />
  );
  check(
    "the Preview as Client button hides while already previewing (no re-entrant confusion)",
    !demoPreviewingHtml.includes("Preview as Client")
  );

  console.log("\n--- Full AppShell + admin content composition ---");
  const fullAdminHtml = renderToStaticMarkup(
    <AppShell role="admin" activeKey="overview" onNavigate={() => {}} userName="Brent Leibee (Admin)" projectName={projectMeta.name}>
      <SampleDataTag />
      <AdminOverviewScreen onOpenProject={() => {}} adminVM={adminVM} />
    </AppShell>
  );
  check("full admin composition renders the sample-data disclosure tag", fullAdminHtml.includes("Sample data"));
  check("full admin composition renders the project card", fullAdminHtml.includes(projectMeta.name));

  console.log("\n--- Full AppShell + client preview banner composition ---");
  const fullClientPreviewHtml = renderToStaticMarkup(
    <AppShell role="client" activeKey="home" onNavigate={() => {}} userName={projectMeta.clientNames ?? "Client"} isPreviewingAsClient onExitPreview={() => {}}>
      <ClientHomeScreen onGoToBudget={() => {}} clientVM={clientVM} />
    </AppShell>
  );
  check("client preview shows the persistent 'Client preview' banner", fullClientPreviewHtml.includes("Client preview"));
  check("client preview shows an Exit preview control", fullClientPreviewHtml.includes("Exit preview"));
  check(
    "client preview does not overclaim ('reflects real client visibility rules' is NOT the banner text)",
    !fullClientPreviewHtml.includes("reflects real client visibility rules")
  );

  console.log("\n--- Mobile 'More' menu reaches Updates & Photos / Documents (unchanged from Package 2) ---");
  const moreOpenHtml = renderToStaticMarkup(
    <AppShell role="client" activeKey="budget" onNavigate={() => {}} userName="Client" initialMoreSheetOpen>
      <div />
    </AppShell>
  );
  check("More sheet, when open, reaches Updates & Photos", moreOpenHtml.includes("Updates &amp; Photos"));
  check("More sheet, when open, reaches Documents", moreOpenHtml.includes(">Documents<"));

  console.log(`\nrender_smoke.tsx (preview app): all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
