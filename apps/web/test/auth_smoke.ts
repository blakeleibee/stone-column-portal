/**
 * HTTP-level route-protection regression test for Package P1. Starts
 * a real `next dev` server twice — once with DEMO_MODE=true (must
 * reproduce every P0 route_smoke.ts assertion, proving zero
 * regression) and once with DEMO_MODE unset (must redirect every
 * protected route to /login, proving real route protection works).
 * Run with `npx tsx test/auth_smoke.ts`.
 */
import { type ChildProcess } from "node:child_process";
import { spawnDevServer, killServerTree } from "./devServerProcess";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "..");
const PORT = Number(process.env.AUTH_SMOKE_PORT) || 4320;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function startServer(demoMode: boolean): ChildProcess {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnDevServer(cmd, ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR,
    env: { ...process.env, DEMO_MODE: demoMode ? "true" : "" },
  });
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/login`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next.js dev server did not become ready within ${timeoutMs}ms`);
}

async function getStatusAndLocation(urlPath: string): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${BASE_URL}${urlPath}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") };
}

async function runWithDemoMode(demoMode: boolean, fn: () => Promise<void>) {
  const server = startServer(demoMode);
  server.stdout?.on("data", (d) => process.stdout.write(`[next dev DEMO_MODE=${demoMode}] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[next dev DEMO_MODE=${demoMode}] ${d}`));
  try {
    await waitForServer(60_000);
    await fn();
  } finally {
    await killServerTree(server);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  console.log("--- DEMO_MODE unset: every protected route redirects unauthenticated requests to /login ---");
  await runWithDemoMode(false, async () => {
    const protectedRoutes = [
      "/",
      "/admin/overview",
      "/admin/financials",
      "/client/home",
      "/client/budget",
      "/vendor",
    ];
    for (const route of protectedRoutes) {
      const { status, location } = await getStatusAndLocation(route);
      check(`${route} redirects (307/308) when unauthenticated`, status === 307 || status === 308);
      check(`${route} redirects to /login`, (location ?? "").includes("/login"));
    }

    const login = await fetch(`${BASE_URL}/login`);
    check("/login itself is reachable (200) without auth", login.status === 200);
  });

  console.log("\n--- DEMO_MODE=true: reproduces every route_smoke.ts route without redirecting ---");
  await runWithDemoMode(true, async () => {
    const demoRoutes = ["/admin/overview", "/admin/financials", "/client/home", "/client/budget"];
    for (const route of demoRoutes) {
      const { status } = await getStatusAndLocation(route);
      check(`${route} responds 200 under DEMO_MODE=true (no auth redirect)`, status === 200);
    }
  });

  console.log(`\nauth_smoke.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
