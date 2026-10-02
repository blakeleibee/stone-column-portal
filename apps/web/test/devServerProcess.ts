/**
 * Shared spawn/teardown helper for the smoke tests that start a real
 * `next dev` server (test/route_smoke.ts, test/auth_smoke.ts).
 *
 * Extracted so the teardown behaviour has ONE definition and can be
 * regression-tested directly (test/devServerProcess_unit.ts) rather than
 * only implicitly, via whether a six-hour CI job eventually times out.
 *
 * WHY THIS FILE EXISTS. `next dev` is not one process. Whichever way it
 * is launched, the pid we hold is a wrapper and the process actually
 * bound to the port is a descendant:
 *
 *   Windows:  cmd.exe (shell) -> npx.cmd -> node -> next-server
 *   POSIX:    npx            -> node    -> next-server
 *
 * Signalling only the pid we hold therefore leaves the real server
 * running. Node will not exit while a spawned child is alive, so
 * `npm run test` hangs forever — which is exactly what happened on CI
 * between July and October 2026: every run was cancelled at the
 * six-hour ceiling, with `Terminate orphan process: next-server` in the
 * teardown log. Both platforms need a TREE-wide kill, not a child kill.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";

const isWin = process.platform === "win32";

export interface DevServerSpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnOptions["stdio"];
}

/** Every live server this process started, for the exit safeguards. */
const liveServers = new Set<ChildProcess>();
let safeguardsInstalled = false;

/**
 * Spawns a long-running dev server.
 *
 * Windows: `shell: true` is required because Node refuses to spawn
 * .cmd/.bat files directly (EINVAL, per the CVE-2024-27980
 * shell-injection fix). Command and args are fixed literals supplied by
 * the callers (never user input), so the injection risk that normally
 * makes `shell: true` dangerous does not apply.
 *
 * POSIX: `detached: true` puts the child in its OWN process group, with
 * the group id equal to its pid. That is what later makes a single
 * `process.kill(-pid, …)` reach `next dev`'s grandchildren instead of
 * just the wrapper. Note the child is deliberately NOT unref()'d — we
 * still want to hold a handle on it.
 */
export function spawnDevServer(command: string, args: string[], options: DevServerSpawnOptions): ChildProcess {
  installExitSafeguards();

  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: isWin,
    detached: !isWin,
    env: options.env,
  });

  liveServers.add(child);
  child.once("exit", () => liveServers.delete(child));
  return child;
}

/** True once the process group (POSIX) or process (Windows) is gone. */
function treeIsGone(server: ChildProcess): boolean {
  if (!server.pid) return true;
  if (server.exitCode !== null || server.signalCode !== null) {
    // The wrapper exited. On POSIX a descendant may still hold the
    // group, so probe the group rather than trusting the wrapper.
    if (isWin) return true;
  }
  try {
    // Signal 0 performs the permission/existence check without sending
    // anything. ESRCH means nothing in the group is left.
    process.kill(isWin ? server.pid : -server.pid, 0);
    return false;
  } catch {
    return true;
  }
}

/**
 * Terminates a spawned dev server and everything beneath it.
 *
 * Graceful first (SIGTERM to the group, so `next dev` can close its
 * sockets), then forceful if anything is still alive. Returns only once
 * the tree is actually gone, or after the escalation has been sent —
 * callers await this in a `finally`, so a half-finished teardown would
 * reintroduce the very hang this exists to prevent.
 */
export async function killServerTree(server: ChildProcess): Promise<void> {
  liveServers.delete(server);
  if (!server.pid) return;

  if (isWin) {
    // Kills the whole tree rooted at the cmd.exe wrapper. Blocking, not
    // fire-and-forget: auth_smoke.ts spawn-kill-respawns on the SAME
    // port twice in immediate succession, and a fire-and-forget kill
    // lets the second server race the first one's port release.
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    return;
  }

  signalGroup(server, "SIGTERM");

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (treeIsGone(server)) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Still alive after the grace period — stop asking.
  signalGroup(server, "SIGKILL");
  const hardDeadline = Date.now() + 2000;
  while (Date.now() < hardDeadline) {
    if (treeIsGone(server)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Sends a signal to the child's whole process group, falling back to
 * the child alone if the group is already gone or was never created.
 */
function signalGroup(server: ChildProcess, signal: NodeJS.Signals): void {
  if (!server.pid) return;
  try {
    process.kill(-server.pid, signal);
  } catch {
    try {
      server.kill(signal);
    } catch {
      // Already dead — nothing to do.
    }
  }
}

/** Synchronous best-effort teardown, for exit handlers that cannot await. */
function killNow(server: ChildProcess): void {
  if (!server.pid) return;
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    return;
  }
  signalGroup(server, "SIGKILL");
}

/**
 * Previously only the happy path cleaned up: a thrown assertion inside
 * the `finally`, an unhandled rejection, or Ctrl-C would all leak a
 * server and hang the run exactly as the original defect did. These
 * handlers make teardown unconditional.
 */
function installExitSafeguards(): void {
  if (safeguardsInstalled) return;
  safeguardsInstalled = true;

  const cleanup = () => {
    for (const server of liveServers) killNow(server);
    liveServers.clear();
  };

  process.on("exit", cleanup);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(1);
    });
  }

  process.on("uncaughtException", (err) => {
    cleanup();
    console.error(err);
    process.exit(1);
  });

  process.on("unhandledRejection", (err) => {
    cleanup();
    console.error(err);
    process.exit(1);
  });
}
