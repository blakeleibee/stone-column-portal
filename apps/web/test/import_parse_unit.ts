/**
 * Unit tests for the pure QuickBooks CSV parsing/matching module
 * (src/server/imports/parseQuickBooksCsv.ts). No I/O beyond reading the
 * sample fixture CSV from disk; no database, no Next.js, no Route
 * Handler involved (that's Task 9). Follows authorization_unit.ts's
 * plain assert/console-report style.
 *
 * Shared fixture: tests/fixtures/quickbooks/sample_job_cost_export.csv
 * with project cost codes [5010, 5030] and a "prefix" match strategy
 * (prefix length 4):
 *   Row 1  5010          / ABC Framing LLC   / 2026-06-01 / 12500.00  -> new (clean prefix match on "5010")
 *   Row 2  5010 - Lumber / XYZ Lumber Supply / 2026-06-03 / 8420.50   -> new (prefix "5010 - Lumber".slice(0,4) === "5010")
 *   Row 3  9999-SPECIAL  / Unknown Vendor    / 2026-06-04 / 300.00    -> unmatched (prefix "9999" matches no project cost code)
 *   Row 4  5010          / ABC Framing LLC   / 2026-06-01 / 12500.00  -> duplicate (identical vendor+date+amount+resolved cost code as row 1)
 *   Row 5  5030          / Bad Row Vendor    / 2026-06-05 / not-a-number -> error (amount does not parse to a finite number)
 *   Row 6  MISC-LABOR    / General Labor Co  / 2026-06-06 / 1500.00   -> new, but resolvedCostCodeId comes from an item
 *                                                                          override ("MISC-LABOR" -> "5030"), not a prefix
 *                                                                          match: "MISC-LABOR".slice(0,4) === "MISC", which
 *                                                                          matches no project cost code on its own.
 *   Row 7  5010          / Formatted Currency Vendor / 2026-06-07 / "$1,234.56" -> new, amountCents === 123456
 *                                                                          (final-review fix: currency symbol + thousands
 *                                                                          separator must not be misparsed).
 *   Row 8  5030          / Credit Memo Vendor        / 2026-06-08 / (500.00)    -> new, amountCents === -50000
 *                                                                          (final-review fix: a QuickBooks parenthesized
 *                                                                          negative must produce a NEGATIVE cents value,
 *                                                                          not have its sign silently stripped).
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseQuickBooksCsv, type MatchContext } from "../../../packages/02-app-shell/src/imports/parseQuickBooksCsv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "..", "..", "tests", "fixtures", "quickbooks", "sample_job_cost_export.csv");

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

const PROJECT_COST_CODES = [
  { id: "cc-5010", code: "5010" },
  { id: "cc-5030", code: "5030" },
];

function baseContext(overrides: Partial<MatchContext["mappingProfile"]> = {}, existingExpenseKeys = new Set<string>()): MatchContext {
  return {
    mappingProfile: {
      columnMapping: { item: "Item", vendor: "Name", amount: "Amount", date: "Date" },
      costCodeMatchStrategy: "prefix",
      costCodePrefixLength: 4,
      itemOverrides: { "MISC-LABOR": "5030" },
      ...overrides,
    },
    projectCostCodes: PROJECT_COST_CODES,
    existingExpenseKeys,
  };
}

async function main() {
  const fixtureCsv = readFileSync(FIXTURE_PATH, "utf-8");

  console.log("--- Prefix match resolves correctly ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row1 = rows[0];
    check("row 1 (item '5010') matches cost code cc-5010 via prefix", row1.resolvedCostCodeId === "cc-5010");
    check("row 1 matchStatus is 'new'", row1.matchStatus === "new");

    const row2 = rows[1];
    check(
      "row 2 (item '5010 - Lumber') prefix-matches cc-5010 after trimming/slicing to the first 4 chars",
      row2.resolvedCostCodeId === "cc-5010" && row2.matchStatus === "new"
    );
  }

  console.log("\n--- Item override takes precedence over prefix match, even when a prefix would otherwise apply ---");
  {
    // "5010-OVERRIDE" has a plausible prefix match on its own ("5010" -> cc-5010),
    // but an explicit override maps this exact item string to cost code "5030".
    // If the override is genuinely checked first, the result must be cc-5030,
    // not cc-5010.
    const csv = "Item,Name,Amount,Date\n5010-OVERRIDE,Override Test Vendor,999.00,2026-06-10\n";
    const ctx = baseContext({ itemOverrides: { "5010-OVERRIDE": "5030" } });
    const rows = parseQuickBooksCsv(csv, ctx);
    check(
      "item override ('5010-OVERRIDE' -> code 5030) wins over the plausible prefix match ('5010' -> cc-5010)",
      rows[0].resolvedCostCodeId === "cc-5030"
    );
  }

  console.log("\n--- Item override hit in the shared fixture (row 6, no plausible prefix match on its own) ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row6 = rows[5];
    check(
      "row 6 (item 'MISC-LABOR', no prefix of its own would match) resolves via itemOverrides to cc-5030",
      row6.resolvedCostCodeId === "cc-5030" && row6.matchStatus === "new"
    );
  }

  console.log("\n--- Exact-strategy match ---");
  {
    const csv = "Item,Name,Amount,Date\n5030,Exact Match Vendor,250.00,2026-06-11\n5030X,No Match Vendor,100.00,2026-06-12\n";
    const ctx = baseContext({ costCodeMatchStrategy: "exact", itemOverrides: {} });
    const rows = parseQuickBooksCsv(csv, ctx);
    check("exact strategy: item '5030' resolves to cc-5030", rows[0].resolvedCostCodeId === "cc-5030" && rows[0].matchStatus === "new");
    check(
      "exact strategy: item '5030X' does NOT resolve (exact strategy is not a prefix match)",
      rows[1].resolvedCostCodeId === null && rows[1].matchStatus === "unmatched"
    );
  }

  console.log("\n--- In-file duplicate detected ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row4 = rows[3];
    check(
      "row 4 (exact duplicate of row 1: same vendor/date/amount/resolved cost code) is flagged 'duplicate'",
      row4.matchStatus === "duplicate" && row4.resolvedCostCodeId === "cc-5010"
    );
    // Row 1 itself must still be 'new' — it's the first occurrence, not a duplicate of itself.
    check("row 1 (the first occurrence) is still 'new', not 'duplicate'", rows[0].matchStatus === "new");
  }

  console.log("\n--- Duplicate against an existing expense (existingExpenseKeys) ---");
  {
    // Row 2's key: vendor "XYZ Lumber Supply", date "2026-06-03", amount 842050 cents, cost code cc-5010.
    const existingKey = "XYZ Lumber Supply|2026-06-03|842050|cc-5010";
    const rowsWithoutExisting = parseQuickBooksCsv(fixtureCsv, baseContext({}, new Set()));
    check("without a matching existingExpenseKeys entry, row 2 is 'new'", rowsWithoutExisting[1].matchStatus === "new");

    const rowsWithExisting = parseQuickBooksCsv(fixtureCsv, baseContext({}, new Set([existingKey])));
    check(
      "with a matching existingExpenseKeys entry, row 2 is flagged 'duplicate' against the existing expense",
      rowsWithExisting[1].matchStatus === "duplicate"
    );
  }

  console.log("\n--- Unmatched item produces matchStatus 'unmatched', not a thrown error ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row3 = rows[2];
    check(
      "row 3 (item '9999-SPECIAL', prefix '9999' matches no project cost code) is 'unmatched' with a null resolvedCostCodeId",
      row3.matchStatus === "unmatched" && row3.resolvedCostCodeId === null
    );
    check("row 3 has no errorMessage", row3.errorMessage === undefined);
  }

  console.log("\n--- Malformed amount produces matchStatus 'error' with a row number in errorMessage ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row5 = rows[4];
    check("row 5 (amount 'not-a-number') is flagged 'error'", row5.matchStatus === "error");
    check(
      "row 5's errorMessage references its row number (5)",
      typeof row5.errorMessage === "string" && row5.errorMessage.includes("Row 5")
    );
  }

  console.log("\n--- Missing/empty date also produces an error ---");
  {
    const csv = "Item,Name,Amount,Date\n5010,No Date Vendor,100.00,\n";
    const rows = parseQuickBooksCsv(csv, baseContext());
    check("row with an empty Date field is flagged 'error'", rows[0].matchStatus === "error");
    check(
      "empty-date error message references its row number (1)",
      typeof rows[0].errorMessage === "string" && rows[0].errorMessage.includes("Row 1")
    );
  }

  console.log("\n--- 'manual_only' strategy never auto-resolves, even when a plausible prefix match would otherwise apply ---");
  {
    // Item "5010" would prefix-match cc-5010 under the "prefix" strategy (proven
    // above); under "manual_only" it must resolve to null regardless, and with
    // no override present it must land on 'unmatched', not throw.
    const csv = "Item,Name,Amount,Date\n5010,Manual Only Vendor,500.00,2026-06-13\n";
    const ctx = baseContext({ costCodeMatchStrategy: "manual_only", itemOverrides: {} });
    const rows = parseQuickBooksCsv(csv, ctx);
    check("manual_only strategy leaves resolvedCostCodeId null despite a plausible prefix match", rows[0].resolvedCostCodeId === null);
    check("manual_only strategy row is 'unmatched', not auto-resolved to 'new'", rows[0].matchStatus === "unmatched");
  }

  console.log("\n--- Amount canonicalization: currency symbol + thousands separator (final-review fix 1) ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row7 = rows[6];
    check(
      "row 7 ('$1,234.56') parses to amountCents === 123456, not NaN and not truncated at the comma",
      row7.amountCents === 123456
    );
    check("row 7 is 'new' (a validly parsed, resolvable, non-duplicate row)", row7.matchStatus === "new");
  }

  console.log("\n--- Amount canonicalization: QuickBooks parenthesized negative (final-review fix 1) ---");
  {
    const rows = parseQuickBooksCsv(fixtureCsv, baseContext());
    const row8 = rows[7];
    check(
      "row 8 ('(500.00)') parses to amountCents === -50000 — the sign must survive, not be stripped along with the parens",
      row8.amountCents === -50000
    );
    check("row 8 is 'new' (a validly parsed, resolvable, non-duplicate row)", row8.matchStatus === "new");
  }

  console.log(`\nimport_parse_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
