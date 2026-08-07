/**
 * Unit tests for the pure QuickBooks CSV parsing/matching module
 * (packages/02-app-shell/src/imports/parseQuickBooksCsv.ts). No I/O beyond reading the
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

  console.log("\n--- Date canonicalization: ISO and MM/DD/YYYY representations of the same date resolve identically, and cross-format in-file duplicates are detected (P4 post-closeout fix) ---");
  {
    // Two rows for the same vendor/amount/cost-code, but the date is
    // written in DIFFERENT formats: row 1 uses ISO, row 2 uses
    // QuickBooks Desktop's default MM/DD/YYYY export convention, for the
    // SAME underlying calendar date (2026-07-04). Before the fix, the
    // duplicate-detection key was built from the raw, unnormalized date
    // string, so these two rows would never match each other even though
    // they represent the same expense. After the fix, both canonicalize
    // to "2026-07-04" and row 2 must be flagged 'duplicate' against row 1.
    const csv = [
      "Item,Name,Amount,Date",
      "5010,Cross Format Vendor,750.00,2026-07-04",
      "5010,Cross Format Vendor,750.00,07/04/2026",
    ].join("\n");
    const rows = parseQuickBooksCsv(csv, baseContext());
    check("ISO-dated row 1 is 'new'", rows[0].matchStatus === "new");
    check("ISO-dated row 1's canonicalDate is '2026-07-04'", rows[0].canonicalDate === "2026-07-04");
    check(
      "MM/DD/YYYY-dated row 2's canonicalDate matches row 1's ISO canonicalDate (same underlying date)",
      rows[1].canonicalDate === rows[0].canonicalDate
    );
    check(
      "MM/DD/YYYY-dated row 2 is flagged 'duplicate' against the ISO-dated row 1, even though the raw date strings differ",
      rows[1].matchStatus === "duplicate"
    );
  }

  console.log("\n--- Date canonicalization: garbage/invalid calendar dates are rejected, not silently normalized (P4 post-closeout fix) ---");
  {
    // "02/30/2026" has a plausible MM/DD/YYYY shape but February 30th
    // does not exist. This must fail to parse, not silently become some
    // nearby real date.
    const csv = "Item,Name,Amount,Date\n5010,Bad Date Vendor,100.00,02/30/2026\n";
    const rows = parseQuickBooksCsv(csv, baseContext());
    check("row with date '02/30/2026' (Feb 30th does not exist) has canonicalDate === null", rows[0].canonicalDate === null);
    check("row with an invalid calendar date is flagged 'error'", rows[0].matchStatus === "error");
    check(
      "the error message distinguishes a date failure from an amount failure",
      typeof rows[0].errorMessage === "string" && rows[0].errorMessage.includes("date") && !rows[0].errorMessage.includes("amount")
    );
  }

  console.log("\n--- Date canonicalization: month 13 / day 32 rejected outright ---");
  {
    const csv = [
      "Item,Name,Amount,Date",
      "5010,Bad Month Vendor,100.00,13/01/2026",
      "5010,Bad Day Vendor,100.00,01/32/2026",
    ].join("\n");
    const rows = parseQuickBooksCsv(csv, baseContext());
    check("date '13/01/2026' (month 13 does not exist) has canonicalDate === null and is flagged 'error'", rows[0].canonicalDate === null && rows[0].matchStatus === "error");
    check("date '01/32/2026' (day 32 does not exist) has canonicalDate === null and is flagged 'error'", rows[1].canonicalDate === null && rows[1].matchStatus === "error");
  }

  console.log("\n--- Duplicates across separate import batches, with a date-format mismatch (the actual bug being fixed) ---");
  {
    // Simulates existingExpenseKeys the way stageImportBatch() really
    // builds it: from a real `expenses` row, whose transaction_date
    // PostgREST always returns in canonical YYYY-MM-DD, regardless of
    // how the expense was originally written. Here that expense was
    // posted from an EARLIER import batch whose source CSV used ISO
    // dates (or was entered by hand) — the date is already canonical
    // "2026-07-10" by the time it comes back from Postgres.
    const existingExpenseKeys = new Set(["Cross Batch Vendor|2026-07-10|99900|cc-5010"]);

    // Now a SECOND import batch's CSV — a different file, using
    // QuickBooks Desktop's own default MM/DD/YYYY export format — reports
    // the exact same underlying transaction (same vendor, same amount,
    // same cost code, same calendar date, just written as "07/10/2026").
    const csv = "Item,Name,Amount,Date\n5010,Cross Batch Vendor,999.00,07/10/2026\n";
    const rows = parseQuickBooksCsv(csv, baseContext({}, existingExpenseKeys));
    check(
      "a second batch's MM/DD/YYYY-formatted row is flagged 'duplicate' against a prior batch's canonical-YYYY-MM-DD existingExpenseKeys entry for the same underlying date",
      rows[0].matchStatus === "duplicate"
    );
  }

  console.log("\n--- Negative control: same vendor/amount/cost-code on a genuinely DIFFERENT date is NOT flagged as a duplicate ---");
  {
    // Proves the date component of the duplicate key actually
    // discriminates — this is not merely "duplicate detection exists",
    // it's "duplicate detection correctly distinguishes two legitimate,
    // separate transactions that only differ by date."
    const existingExpenseKeys = new Set(["Repeat Vendor|2026-07-10|50000|cc-5010"]);
    const csv = "Item,Name,Amount,Date\n5010,Repeat Vendor,500.00,07/11/2026\n";
    const rows = parseQuickBooksCsv(csv, baseContext({}, existingExpenseKeys));
    check(
      "same vendor/amount/cost-code but a different date (07/11 vs 07/10) is 'new', not flagged as a duplicate",
      rows[0].matchStatus === "new"
    );
  }

  console.log(`\nimport_parse_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
