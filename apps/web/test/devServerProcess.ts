/**
 * Shared spawn/teardown helper for the smoke tests that start a real
 * `next dev` server (test/route_smoke.ts, test/auth_smoke.ts).
 *
 * Extracted so the teardown behaviour has ONE definition and can be
 * regression-tested directly (test/devServerProcess_unit.ts) rather than
 * only implicitly, via whether a six-hour CI job eventually times out.
 *
 * This commit is a pure refactor: the behaviour below is byte-for-byte
 * the logic that previously lived inline in both callers, including its
 * known defect on POSIX. The fix follows in the next commit, so the
 * regression test can be seen failing against the real behaviour first.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";

const isWin = process.platform === "win32";

export interface DevServerSpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnOptions["stdio"];
}

/**
 * Spawns a long-running dev server.
 *
 * On Windows, Node refuses to spawn .cmd/.bat files directly (EINVAL,
 * per the CVE-2024-27980 shell-injection fix), so `shell: true` is
 * required there. Command and args are fixed literals supplied by the
 * callers below (never user input), so the shell-injection risk that
 * normally makes `shell: true` dangerous does not apply.
 */
export function spawnDevServer(command: string, args: string[], options: DevServerSpawnOptions): ChildProcess {
  return spawn(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: isWin,
    env: options.env,
  });
}

/**
 * Terminates a spawned dev server.
 *
 * Windows: `shell: true` means `server.pid` is a cmd.exe wrapper and
 * `next dev` re-spawns its own children beneath it, so `server.kill()`
 * would signal only the wrapper. `taskkill /T` kills the whole tree.
 *
 * POSIX: signals only the direct child. See devServerProcess_unit.ts —
 * this is the defect that leaves `next-server` orphaned on Linux.
 */
export async function killServerTree(server: ChildProcess): Promise<void> {
  if (isWin && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    return;
  }
  server.kill();
}
