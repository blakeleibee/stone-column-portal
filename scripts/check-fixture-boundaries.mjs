#!/usr/bin/env node
// Fails if a fixture-only module (sample/demo data, or the fixture
// repository) is referenced from anywhere outside apps/web's own
// preview-app source tree or a test file. Extends the equivalent,
// smaller-scope check already enforced in
// packages/02-app-shell/test/render_smoke.tsx to the whole repo, per
// PRODUCTION-ROADMAP.md's Package P0 CI scope.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN_SUBSTRINGS = ["fixtures/hawksRidge", "data/fixtureFinancialRepository", "data/sampleContent"];

// Files allowed to reference the above: the entire preview app (its
// whole purpose is demonstrating real logic against fixture data), any
// test file anywhere, and the fixture repository's own definition file
// (which legitimately imports the raw fixture data it wraps).
const ALLOWED_PATTERNS = [
  /^apps\/web\//,
  /\/test\//,
  /\.test\./,
  /packages\/02-app-shell\/src\/data\/fixtureFinancialRepository\.ts$/,
];

const trackedFiles = execSync('git ls-files -- "*.ts" "*.tsx"', { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const failures = [];

for (const file of trackedFiles) {
  if (ALLOWED_PATTERNS.some((pattern) => pattern.test(file))) continue;
  const content = readFileSync(file, "utf8");
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (content.includes(forbidden)) {
      failures.push(`${file} references "${forbidden}" outside its allowed boundary`);
    }
  }
}

// Second check: `new FixtureFinancialRepository(` must only appear in
// the one file allowed to construct it directly (getRepository.ts's
// DEMO_MODE-gated factory) or a test file.
const CONSTRUCTOR_PATTERN = "new FixtureFinancialRepository(";
const CONSTRUCTOR_ALLOWED_PATTERNS = [
  /apps\/web\/src\/data\/getRepository\.ts$/,
  // KNOWN, INTENTIONAL, TEMPORARY EXCEPTION (P1 scope decision, see
  // docs/production-build/P1-DESIGN.md §D): every admin/client screen
  // except /admin/financials still reads fixture data unconditionally
  // via loadViewModels.ts's loadAdminVM()/loadClientVM(), even outside
  // DEMO_MODE -- full fixture replacement across every screen is
  // later-package scope, not P1's. Remove this line only once a later
  // package replaces loadViewModels.ts's remaining fixture-only call
  // sites with getRepository()-backed equivalents.
  /apps\/web\/src\/data\/loadViewModels\.ts$/,
  /\/test\//,
  /\.test\./,
];

for (const file of trackedFiles) {
  if (CONSTRUCTOR_ALLOWED_PATTERNS.some((pattern) => pattern.test(file))) continue;
  const content = readFileSync(file, "utf8");
  if (content.includes(CONSTRUCTOR_PATTERN)) {
    failures.push(`${file} constructs FixtureFinancialRepository directly outside getRepository.ts's DEMO_MODE gate`);
  }
}

if (failures.length > 0) {
  console.error("Fixture/demo data referenced outside its allowed boundary:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nFixture data (fixtures/hawksRidge, sampleContent, FixtureFinancialRepository) may only be " +
      "referenced from apps/web's own source tree or a test file. See PRODUCTION-ROADMAP.md's P0 CI scope."
  );
  process.exit(1);
}

console.log(`OK — checked ${trackedFiles.length} tracked TypeScript files, no fixture-boundary violations.`);
