/**
 * Route/rendering regression test for the Next.js migration (Package
 * P0). Starts a real `next dev` server and fetches every route
 * reachable today, asserting the same content the old esbuild-era
 * test/render_smoke.tsx asserted on via direct component rendering.
 * Run with `npx tsx test/route_smoke.ts`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

    const projects = await getHtml("/admin/projects");
    check("/admin/projects responds 200", projects.status === 200);
    check("/admin/projects renders the project workspace tabs", projects.html.includes(">Financials<"));

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
