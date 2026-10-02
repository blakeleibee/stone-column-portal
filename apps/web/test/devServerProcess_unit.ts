/**
 * Regression test for the CI-hanging defect in the smoke-test harness.
 *
 * THE BUG. route_smoke.ts and auth_smoke.ts each start a real `next dev`
 * server and tear it down in a `finally`. On Windows that teardown used
 * `taskkill /T`, which kills the whole process tree. On POSIX it called
 * `server.kill()`, which signals ONLY the direct child — so `next dev`'s
 * own grandchildren (the actual `next-server` process) survived.
 *
 * Node will not exit while a spawned child is still alive, so
 * `npm run test` never returned on Linux. Every GitHub Actions run since
 * July 2026 hung after route_smoke.ts printed "all 66 checks passed" and
 * was cancelled at the six-hour ceiling; the job teardown log listed
 * `Terminate orphan process: next-server` as proof. Nothing failed — the
 * suite simply never finished, so no later step (SQL tests, auth smoke,
 * build) ever ran. It never reproduced on Windows, which is why local
 * runs were always green.
 *
 * WHAT THIS TEST DOES. Spawning a real `next dev` here would be slow and
 * would couple this test to the app. Instead it spawns the same SHAPE of
 * process tree — a parent that spawns a grandchild which holds a TCP
 * port — through the same helper the smoke tests use, then asserts the
 * whole tree is gone afterwards.
 *
 * The port is the assertion: a listening socket is only released when
 * the process holding it actually dies. If the grandchild is orphaned,
 * rebinding fails and this test fails. That is exactly the condition
 * that hung CI.
 *
 * Run with `npx tsx test/devServerProcess_unit.ts`.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDevServer, killServerTree } from "./devServerProcess";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "..");
const PORT = Number(process.env.DEV_SERVER_PROCESS_TEST_PORT) || 4390;

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The fixture tree is written to real temp FILES rather than passed as
 * inline `node -e` source: on Windows spawnDevServer uses `shell: true`,
 * which concatenates rather than escapes arguments, so inline source
 * containing quotes and newlines is mangled before node ever sees it.
 * File paths survive that intact on both platforms.
 */
function writeFixtureScripts(dir: string): string {
  const grandchild = path.join(dir, "grandchild.cjs");
  const parent = path.join(dir, "parent.cjs");

  // Grandchild: binds PORT and stays alive until killed.
  fs.writeFileSync(
    grandchild,
    [
      'const net = require("node:net");',
      "const server = net.createServer(() => {});",
      `server.listen(${PORT}, "127.0.0.1", () => { process.stdout.write("LISTENING\\n"); });`,
      "setInterval(() => {}, 1000);",
    ].join("\n")
  );

  // Parent: spawns the grandchild and stays alive — the same shape as
  // npx -> next dev -> next-server.
  fs.writeFileSync(
    parent,
    [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: "inherit" });`,
      "setInterval(() => {}, 1000);",
    ].join("\n")
  );

  return parent;
}

async function portIsListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: "127.0.0.1" });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 1000);
  });
}

async function waitForPort(listening: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await portIsListening()) === listening) return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  console.log("--- killServerTree terminates the ENTIRE spawned process tree ---");

  if (await portIsListening()) {
    throw new Error(`Port ${PORT} is already in use — cannot run this test reliably.`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-server-tree-"));
  const parentScript = writeFixtureScripts(tmpDir);

  // "node" from PATH, not process.execPath: on Windows spawnDevServer
  // uses shell:true, which concatenates arguments without quoting, and
  // the absolute node path ("C:\Program Files\...") would break on its
  // space. The real smoke tests invoke "npx.cmd" from PATH for the same
  // reason, so this matches how the helper is actually used.
  const server = spawnDevServer("node", [parentScript], {
    cwd: APP_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  check("a parent process was spawned with a real pid", typeof server.pid === "number" && server.pid > 0);

  const cameUp = await waitForPort(true, 20000);
  check("the spawned tree's GRANDCHILD is holding the port (tree is genuinely nested)", cameUp);

  await killServerTree(server);

  // The real assertion. If only the direct child was signalled, the
  // grandchild keeps the socket and this never goes free — the exact
  // orphaning that hung CI for six hours a run.
  const released = await waitForPort(false, 15000);
  check("after killServerTree, the port is released — no orphaned grandchild survives", released);

  // Belt and braces: the direct child must be gone too.
  const childGone = server.exitCode !== null || server.signalCode !== null || server.killed;
  check("the direct child process is terminated as well", childGone);

  console.log(`\ndevServerProcess_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
