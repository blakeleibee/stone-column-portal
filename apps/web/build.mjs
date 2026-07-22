// Build + dev-server script using esbuild directly (no Vite needed for
// an app this size).
//
// Usage:
//   node build.mjs --serve   (dev server, live rebuild on each request)
//   node build.mjs --build   (production build to dist/)
//
// Port: defaults to 5173; override with PORT=xxxx node build.mjs --serve
// if 5173 is already in use on your machine.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let esbuild;
try {
  esbuild = await import("esbuild");
} catch (err) {
  console.error(
    "\nCould not load 'esbuild'. This almost always means `npm install` " +
      "was not run yet (or failed) in this directory.\n\n" +
      "Fix:\n  cd apps/web\n  npm install\n  npm run dev\n\n" +
      "If `npm install` itself failed, please share the exact error output " +
      "from that command — it's the most useful thing to debug next.\n"
  );
  process.exit(1);
}

const mode = process.argv.includes("--build") ? "build" : "serve";
const outDir = path.join(__dirname, mode === "build" ? "dist" : "dev-dist");
const port = Number(process.env.PORT) || 5173;

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "index.html"), path.join(outDir, "index.html"));

  const buildOptions = {
    entryPoints: [path.join(__dirname, "src/main.tsx")],
    bundle: true,
    outfile: path.join(outDir, "bundle.js"),
    jsx: "automatic",
    sourcemap: true,
    target: "es2020",
    define: {
      "process.env.NODE_ENV": mode === "build" ? '"production"' : '"development"',
    },
    minify: mode === "build",
    logLevel: "info",
  };

  // Static assets referenced by plain path string (e.g. AppShell.tsx's
  // "/assets/logo.jpg") rather than an ES import — an ES import of a
  // binary image file isn't something `tsx` (used to run the test
  // suite) can resolve without a bundler, so this keeps the same asset
  // usable both in the real browser bundle and in the plain-Node test run.
  const assetsSrcDir = path.join(__dirname, "..", "..", "packages", "02-app-shell", "src", "assets");
  const assetsOutDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsOutDir, { recursive: true });
  for (const file of fs.readdirSync(assetsSrcDir)) {
    fs.copyFileSync(path.join(assetsSrcDir, file), path.join(assetsOutDir, file));
  }

  if (mode === "build") {
    await esbuild.build(buildOptions);
    console.log(`\nProduction build complete -> ${outDir}/`);
    console.log(`Serve it with any static file server, e.g.: npx http-server ${path.relative(__dirname, outDir)}`);
  } else {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    const serveResult = await ctx.serve({
      servedir: outDir,
      port,
      host: "127.0.0.1",
    });
    const url = `http://127.0.0.1:${serveResult.port}`;
    console.log(`\n✓ Stone Column Portal preview running at ${url}`);
    console.log("Sample data only — no authentication, no Supabase, no real credentials.");
    console.log("Press Ctrl+C to stop.");
    console.log("If the page doesn't load, confirm this exact URL matches what your browser is opening,");
    console.log(`and that nothing else on your machine is already using port ${port}.\n`);
  }
} catch (err) {
  console.error("\nBuild/serve failed:\n");
  console.error(err && err.message ? err.message : err);
  if (String(err && err.message).includes("EADDRINUSE")) {
    console.error(
      `\nPort ${port} is already in use on your machine. Try:\n  PORT=5174 npm run dev\n(or any other free port)`
    );
  }
  process.exit(1);
}
