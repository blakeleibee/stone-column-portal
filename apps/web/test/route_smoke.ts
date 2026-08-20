/**
 * Route/rendering regression test for the Next.js migration (Package
 * P0). Starts a real `next dev` server and fetches every route
 * reachable today, asserting the same content the old esbuild-era
 * test/render_smoke.tsx asserted on via direct component rendering.
 * Run with `npx tsx test/route_smoke.ts`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAdminVM, loadClientVM } from "../src/data/loadViewModels";
import { formatCents } from "../../../packages/01-financial-engine/src/money";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "..");
const PORT = Number(process.env.ROUTE_SMOKE_PORT) || 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function isLabeledAsPreview(html: string): boolean {
  return html.includes("Preview only") || html.includes("Preview content");
}

function buttonTagFor(html: string, textFragment: string): string | null {
  const idx = html.indexOf(textFragment);
  if (idx === -1) return null;
  const openTagStart = html.lastIndexOf("<button", idx);
  const openTagEnd = html.indexOf(">", openTagStart);
  if (openTagStart === -1 || openTagEnd === -1) return null;
  return html.slice(openTagStart, openTagEnd + 1);
}

/**
 * Task 6 (P3) regression guard for Task 5's overview/financials fix —
 * see this function's call sites below for the full "why a source-level
 * check, not an HTTP one" reasoning. Confirms `fixtureIdentifiers` (the
 * fixture bindings imported at the top of `filePath`, e.g.
 * `demoProjectMeta`) are referenced ONLY inside the file's
 * `if (isDemoMode()) { ... }` branch — i.e. the real (non-demo) code
 * path that runs for an actual authenticated session cannot reach the
 * fixture import at all, because it's lexically unreachable once that
 * branch's block has returned. Brace-counts from the first `{` after
 * `if (isDemoMode())` to find that block's matching `}`, then checks
 * the fixture identifiers don't appear anywhere after it.
 */
function checkNoFixtureReferenceOutsideDemoBlock(filePath: string, fixtureIdentifiers: string[], label: string) {
  const source = fs.readFileSync(filePath, "utf8");
  const demoBlockStart = source.indexOf("if (isDemoMode())");
  if (demoBlockStart === -1) {
    throw new Error(`${label}: expected an "if (isDemoMode())" branch guarding fixture usage — found none in ${filePath}.`);
  }
  const braceStart = source.indexOf("{", demoBlockStart);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error(`${label}: could not find the matching closing brace for its "if (isDemoMode())" block in ${filePath}.`);
  }
  const afterDemoBlock = source.slice(i + 1);
  for (const id of fixtureIdentifiers) {
    check(
      `${label}'s real (non-demo) code path never references the fixture binding \`${id}\` (Task 5 fix, Task 6 regression guard)`,
      !afterDemoBlock.includes(id)
    );
  }
}

function startServer(): ChildProcess {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";
  const args = ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"];
  // On Windows, Node refuses to spawn .cmd/.bat files directly (EINVAL) as
  // of the shell-injection security fix (CVE-2024-27980); shell: true is
  // required there. Command/args are fixed literals (no user input), so
  // the shell-injection risk that makes shell:true generally risky does
  // not apply here.
  return spawn(cmd, args, {
    cwd: APP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
    env: { ...process.env, DEMO_MODE: "true" },
  });
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/admin/overview`);
      if (res.status === 200) return;
    } catch {
      // server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next.js dev server did not become ready within ${timeoutMs}ms`);
}

function killServer(server: ChildProcess) {
  // On Windows, startServer() must run through shell:true (Node refuses to
  // spawn .cmd files directly — EINVAL, per the CVE-2024-27980 fix), so
  // server.pid is a cmd.exe wrapper, and `next dev` re-spawns its own
  // child process(es) beneath that. server.kill() only signals the
  // immediate child and leaves the rest of the tree (including the actual
  // dev server bound to the port) running. taskkill /T kills the whole
  // process tree rooted at that PID.
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  } else {
    server.kill();
  }
}

async function getHtml(urlPath: string): Promise<{ status: number; html: string; location: string | null }> {
  const res = await fetch(`${BASE_URL}${urlPath}`, { redirect: "manual" });
  const html = await res.text();
  return { status: res.status, html, location: res.headers.get("location") };
}

async function main() {
  const server = startServer();
  server.stdout?.on("data", (d) => process.stdout.write(`[next dev] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[next dev] ${d}`));

  try {
    await waitForServer(60_000);

    const adminVM = await loadAdminVM();
    const clientVM = await loadClientVM();

    console.log("--- Root redirects to /admin/overview ---");
    const root = await getHtml("/");
    check("root path redirects", root.status === 307 || root.status === 308);
    check("root redirects to /admin/overview", (root.location ?? "").endsWith("/admin/overview"));

    console.log("\n--- Every admin route responds 200, correctly labeled ---");
    const adminPreviewRoutes = ["/admin/action-center", "/admin/conversations", "/admin/contacts", "/admin/settings"];
    for (const route of adminPreviewRoutes) {
      const { status, html } = await getHtml(route);
      check(`${route} responds 200`, status === 200);
      check(`${route} is labeled as preview content`, isLabeledAsPreview(html));
    }

    const overview = await getHtml("/admin/overview");
    check("/admin/overview responds 200", overview.status === 200);
    check("/admin/overview shows the project name", overview.html.includes("Hawks Ridge"));

    console.log("\n--- Financials figure comes from the real engine, not a hardcoded value ---");
    const financials = await getHtml("/admin/financials");
    check("/admin/financials responds 200", financials.status === 200);
    check(
      "admin Financials shows the engine's actual revised-estimate figure",
      financials.html.includes(formatCents(adminVM.totals.revisedEstimateCents))
    );
    check("admin Financials is NOT labeled preview (real engine data)", !isLabeledAsPreview(financials.html));

    console.log("\n--- /admin/estimate is reachable and nav-wired (P4 final-review fix 3) ---");
    const estimate = await getHtml("/admin/estimate");
    check("/admin/estimate responds 200", estimate.status === 200);
    check("/admin/estimate is NOT labeled preview (real engine data, fixture-backed under DEMO_MODE)", !isLabeledAsPreview(estimate.html));
    // "Estimate" appears first in the sidebar nav (which renders before
    // <main> in DOM order), so buttonTagFor's first-match lookup finds
    // the nav button itself, not something inside EstimateTable's own
    // content further down the page.
    const estimateNavTag = buttonTagFor(estimate.html, "Estimate");
    check(
      "/admin/estimate's nav highlights its own 'Estimate' tab (data-active=\"true\"), not 'Financials'",
      !!estimateNavTag && estimateNavTag.includes('data-active="true"')
    );
    const financialsNavTagOnEstimatePage = buttonTagFor(estimate.html, "Financials");
    check(
      "/admin/estimate's 'Financials' nav tab is NOT the active one",
      !!financialsNavTagOnEstimatePage && financialsNavTagOnEstimatePage.includes('data-active="false"')
    );
    // The nav bar renders the FULL adminNav array on every admin page,
    // regardless of which one is active (only data-active differs) — so
    // this already-rendered, already-200 page is a natural place to
    // prove the new "Bids" (P5, Task 6) nav entry actually made it into
    // the rendered sidebar, without needing a separate authenticated
    // fetch of /admin/bids itself (which has no DEMO_MODE fixture path
    // — see the /admin/import-style block below for that route's own
    // reachability proof).
    const bidsNavTagOnEstimatePage = buttonTagFor(estimate.html, "Bids");
    check("nav bar includes the new 'Bids' entry (P5, Task 6)", !!bidsNavTagOnEstimatePage);

    console.log("\n--- /admin/import is reachable and nav-wired, but real-backend-only (no DEMO_MODE fixture path) ---");
    // Unlike /admin/estimate, AdminImportPage always calls requireRole()
    // regardless of DEMO_MODE (see its own doc comment: there is no
    // fixture-repository equivalent for import_batches/import_rows), so
    // under this test's DEMO_MODE=true env with no real session cookie it
    // must redirect to /login rather than render -- this still proves the
    // route/nav wiring exists (P4 final-review fix 3) without requiring a
    // real authenticated Supabase session in this smoke test.
    const importRoute = await getHtml("/admin/import");
    check(
      "/admin/import redirects to /login when unauthenticated (real-backend-only screen, no demo fixture path)",
      (importRoute.status === 307 || importRoute.status === 308) && (importRoute.location ?? "").endsWith("/login")
    );

    console.log("\n--- /admin/bids is reachable and nav-wired, but real-backend-only (no DEMO_MODE fixture path) ---");
    // Same shape as the /admin/import block directly above: AdminBidsPage
    // always calls requireRole() regardless of DEMO_MODE (bid_packages/
    // bid_submissions/bid_questions/bid_addenda have no fixture-repository
    // equivalent — see that page's own doc comment), so under this test's
    // DEMO_MODE=true env with no real session cookie it must redirect to
    // /login rather than render. This still proves the route exists and
    // is nav-wired (Task 6) without requiring a real authenticated
    // Supabase session in this smoke test.
    const bidsRoute = await getHtml("/admin/bids");
    check(
      "/admin/bids redirects to /login when unauthenticated (real-backend-only screen, no demo fixture path)",
      (bidsRoute.status === 307 || bidsRoute.status === 308) && (bidsRoute.location ?? "").endsWith("/login")
    );

    console.log("\n--- /admin/projects is reachable and nav-wired, but real-backend-only (no DEMO_MODE fixture path) ---");
    // Task 4 (P3): AdminProjectsPage now always calls requireRole()
    // regardless of DEMO_MODE, replacing the old stub that unconditionally
    // rendered loadAdminVM()'s fixture project via ProjectWorkspace
    // (ignoring DEMO_MODE entirely — the bug this task's brief flagged).
    // Projects are org-scoped real data with no fixture-repository
    // equivalent, same as /admin/import and /admin/bids above, so under
    // this test's DEMO_MODE=true env with no real session cookie it must
    // redirect to /login rather than render.
    const projectsRoute = await getHtml("/admin/projects");
    check(
      "/admin/projects redirects to /login when unauthenticated (real-backend-only screen, no demo fixture path)",
      (projectsRoute.status === 307 || projectsRoute.status === 308) && (projectsRoute.location ?? "").endsWith("/login")
    );

    console.log("\n--- /admin/projects/[id]/team is reachable, but real-backend-only (no DEMO_MODE fixture path) ---");
    // Task 6 (P3): new per-project team-assignment screen, same
    // real-backend-only shape as every block above — requireRole() runs
    // before any project id is resolved, so an arbitrary path segment is
    // enough to prove the route exists and is protected, without needing
    // a real project id or a real authenticated session.
    const teamRoute = await getHtml("/admin/projects/00000000-0000-0000-0000-000000000000/team");
    check(
      "/admin/projects/[id]/team redirects to /login when unauthenticated (real-backend-only screen, no demo fixture path)",
      (teamRoute.status === 307 || teamRoute.status === 308) && (teamRoute.location ?? "").endsWith("/login")
    );

    console.log("\n--- /admin/projects/[id]/setup is reachable, but real-backend-only (no DEMO_MODE fixture path) ---");
    // Owner-preview correction round (item 11): new post-create setup
    // checklist route, same real-backend-only shape and same
    // requireRole()-before-any-project-id-resolution guard as
    // /admin/projects/[id]/team above — an arbitrary path segment is
    // enough to prove the route exists and is protected, without needing
    // a real project id or a real authenticated session.
    const setupRoute = await getHtml("/admin/projects/00000000-0000-0000-0000-000000000000/setup");
    check(
      "/admin/projects/[id]/setup redirects to /login when unauthenticated (real-backend-only screen, no demo fixture path)",
      (setupRoute.status === 307 || setupRoute.status === 308) && (setupRoute.location ?? "").endsWith("/login")
    );

    console.log(
      "\n--- Regression guard (Task 6): /admin/overview and /admin/financials no longer render the fixture project's name in a real session ---"
    );
    // Task 5 fixed both pages to stop unconditionally rendering
    // loadAdminVM()'s hardcoded Hawks Ridge fixture in a real session
    // (they now branch on isDemoMode() and only use the fixture inside
    // that branch), but added no regression guard for it. The natural
    // HTTP-level guard — fetch the route under a real authenticated
    // session and assert "Hawks Ridge" is absent — is not achievable in
    // THIS harness: unlike the DEMO_MODE=true checks above (which
    // legitimately assert the fixture DOES render — that's demo mode's
    // own contract), there is no mechanism anywhere in this test suite
    // (see auth_smoke.ts, which only ever proves unauthenticated
    // requests redirect) for establishing a real, non-demo, authenticated
    // Supabase session — no seeded test user, no login flow driven here.
    // Faking that with a stubbed session would test the stub, not the
    // app. The honest, achievable substitute: statically prove the real
    // (non-demo) code path in each page's own source can never reach the
    // fixture import in the first place (see
    // checkNoFixtureReferenceOutsideDemoBlock above) — a real session
    // literally cannot render "Hawks Ridge" because the only code that
    // reads `demoProjectMeta`/`demoExpenses` is lexically inside the
    // `if (isDemoMode())` block, unreachable once DEMO_MODE is false.
    checkNoFixtureReferenceOutsideDemoBlock(
      path.join(APP_DIR, "app/admin/overview/page.tsx"),
      // "loadAdminVM(" (with the trailing paren, so it doesn't
      // false-positive against loadAdminVMFor(...)) is the actual
      // original Task 5 bug, not just the fixture bindings: the real
      // (non-demo) path used to call the zero-arg, fixture-backed
      // loadAdminVM() unconditionally instead of
      // loadAdminVMFor(project.id, repo). A future edit reverting that
      // one call site back to loadAdminVM() would reintroduce the bug
      // without ever touching demoProjectMeta/demoExpenses, so it needs
      // its own check, not just the fixture identifiers.
      ["demoProjectMeta", "demoExpenses", "loadAdminVM("],
      "/admin/overview"
    );
    checkNoFixtureReferenceOutsideDemoBlock(
      path.join(APP_DIR, "app/admin/financials/page.tsx"),
      ["demoProjectMeta", "loadAdminVM("],
      "/admin/financials"
    );

    console.log("\n--- Every client route responds 200, correctly labeled ---");
    const clientPreviewRoutes = ["/client/schedule", "/client/selections", "/client/messages", "/client/updates", "/client/documents"];
    for (const route of clientPreviewRoutes) {
      const { status, html } = await getHtml(route);
      check(`${route} responds 200`, status === 200);
      check(`${route} is labeled as preview content`, isLabeledAsPreview(html));
    }

    const home = await getHtml("/client/home");
    check("/client/home responds 200", home.status === 200);
    check("/client/home shows a welcome heading", home.html.includes("Welcome"));
    check("/client/home shows the sample-data disclosure tag", home.html.includes("Sample data"));

    const budget = await getHtml("/client/budget");
    check("/client/budget responds 200", budget.status === 200);
    check(
      "client Budget shows the client-safe view model's actual revised-estimate figure",
      budget.html.includes(formatCents(clientVM.totals.revisedEstimateCents))
    );
    check(
      "client Budget screen does NOT show the admin-only fee-accrued figure",
      !budget.html.includes(formatCents(adminVM.feeSummary.feeAccruedCents))
    );
    check("client Budget is NOT labeled preview (real engine data)", !isLabeledAsPreview(budget.html));

    console.log("\n--- Dead-click controls are disabled, not silently clickable no-ops ---");
    const selections = await getHtml("/client/selections");
    const approveTag = buttonTagFor(selections.html, "Review &amp; Approve");
    check("Selections 'Review & Approve' button exists and is disabled", !!approveTag && approveTag.includes("disabled"));

    const documents = await getHtml("/client/documents");
    const downloadTag = buttonTagFor(documents.html, "Download");
    check("Documents 'Download' button exists and is disabled", !!downloadTag && downloadTag.includes("disabled"));

    console.log("\n--- Preview-as-client banner appears only with ?preview=1 ---");
    check("normal client Budget view has no preview banner", !budget.html.includes("Client preview"));
    const previewBudget = await getHtml("/client/budget?preview=1");
    check("preview view responds 200", previewBudget.status === 200);
    check("preview view shows the Client preview banner", previewBudget.html.includes("Client preview"));
    check("preview view shows an Exit preview control", previewBudget.html.includes("Exit preview"));
    check(
      "preview view does not overclaim ('reflects real client visibility rules' is NOT the banner text)",
      !previewBudget.html.includes("reflects real client visibility rules")
    );

    console.log(`\nroute_smoke.ts: all ${checks} checks passed.`);
  } finally {
    killServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
