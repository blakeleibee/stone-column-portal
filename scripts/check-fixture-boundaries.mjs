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
