import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app imports packages/01-financial-engine and
  // packages/02-app-shell via relative paths that reach outside
  // apps/web's own directory (an npm-workspaces monorepo, not a
  // package-name import) — Next.js blocks that by default.
  //
  // Root package-lock.json lives two levels above apps/web; tell Next
  // explicitly where the monorepo root is instead of letting it guess.
  // NOTE: in the resolved Next 14.2.35, outputFileTracingRoot's zod
  // schema only recognizes it nested under `experimental` (top-level
  // placement is rejected with "Unrecognized key(s)" and silently
  // dropped) — nested here so the value actually takes effect.
  experimental: {
    externalDir: true,
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
  // No linter is configured in this repo yet (see CLAUDE.md's standing
  // disclosure) — do not let `next build` block on an absent eslint
  // config or silently install one.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
