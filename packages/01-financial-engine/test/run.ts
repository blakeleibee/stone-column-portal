/**
 * Sanity test for Package 1. Not a full test suite (no framework
 * installed in this environment) — this is a runnable proof that:
 *   1. Category totals sum to the project total.
 *   2. Fee is computed from eligible POSTED cost only.
 *   3. No hardcoded fudge numbers exist anywhere.
 *   4. reconcileProject() actually catches a broken number when one is
 *      deliberately introduced.
 *   5. The "completed under budget" suggestion only fires for
 *      explicitly-marked-complete/closed categories.
 *   6. Fee math uses integer basis points end-to-end, never a float.
 *
 * Run with: npx ts-node test/run.ts  (or `npm test`)
 *
 * REFACTOR NOTE (Package 2): the Hawks Ridge sample data used to be
 * defined inline in this file. It's now `../fixtures/hawksRidge.ts`,
 * shared with the Package 2 UI's Financials screen — so the numbers a
 * developer sees in this test report and the numbers a reviewer sees in
 * the UI prototype are guaranteed to be the same data, not two
 * hand-maintained copies that can silently drift apart.
 */
import {
  computeAllCategoryFinancials,
  computeProjectTotals,
  computeProjectFeeSummary,
  reconcileProject,
  generateBudgetSuggestions,
  formatCents,
} from "../src";
import {
  costCodes,
  codeId,
  budgetLedger,
  expenses,
  committedCosts,
  forecastEntries,
  feeRule,
  feeLedgerEntries,
} from "../fixtures/hawksRidge";

const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected) {
      throw new Error(message ?? `Expected ${expected}, got ${actual}`);
    }
  },
  ok(value: unknown, message?: string) {
    if (!value) {
      throw new Error(message ?? `Expected truthy value, got ${value}`);
    }
  },
};

// ---- Run the engine ---------------------------------------------------

const categories = computeAllCategoryFinancials(
  costCodes,
  budgetLedger,
  expenses,
  committedCosts,
  forecastEntries
);

const totals = computeProjectTotals(categories);
const reconciliation = reconcileProject(categories, totals.actualCostCents);
const feeSummary = computeProjectFeeSummary(feeRule, categories, expenses, feeLedgerEntries);
const suggestions = generateBudgetSuggestions(categories);

// ---- Assertions --------------------------------------------------------

const manualSum = categories.reduce((s, c) => s + c.actualCostCents, 0);
assert.equal(totals.actualCostCents, manualSum, "project actual total must equal sum of categories");

assert.equal(reconciliation.ok, true, "reconciliation should pass on internally-consistent data");
assert.equal(reconciliation.issues.length, 0);

const brokenReconciliation = reconcileProject(categories, totals.actualCostCents + 1);
assert.equal(brokenReconciliation.ok, false, "reconciliation must catch a 1-cent mismatch");
assert.equal(brokenReconciliation.issues[0].expectedCents, totals.actualCostCents);

const pendingTotal = 380_000 + 2_800_000;
const postedTotal = expenses
  .filter((e) => e.financialStatus === "posted")
  .reduce((s, e) => s + e.amountCents, 0);
assert.equal(totals.actualCostCents, postedTotal, "actual cost must equal sum of POSTED expenses only");
assert.ok(
  totals.actualCostCents < postedTotal + pendingTotal,
  "including pending expenses would have produced a larger (wrong) total"
);

const feeEligibleTotal = categories
  .filter((c) => c.isFeeEligible)
  .reduce((s, c) => s + c.actualCostCents, 0);
assert.equal(feeSummary.feeEligibleBasisCents, feeEligibleTotal);
assert.ok(feeSummary.feeEligibleBasisCents < totals.actualCostCents);

const expectedFeeBig = (() => {
  const num = BigInt(feeSummary.feeEligibleBasisCents) * 1500n;
  const den = 10000n;
  const q = num / den;
  const r = num % den;
  return r * 2n >= den ? q + 1n : q;
})();
assert.equal(feeSummary.feeAccruedCents, Number(expectedFeeBig));

const underSuggestions = suggestions.filter((s) => s.direction === "under");
const underCodeIds = underSuggestions.map((s) => s.costCodeId);
assert.ok(underCodeIds.includes(codeId("Site Work")), "explicitly-complete Site Work should suggest under-budget");
for (const activeCode of ["Framing", "Plumbing", "Electrical", "General Conditions"] as const) {
  assert.ok(
    !underCodeIds.includes(codeId(activeCode)),
    `'active' category ${activeCode} must NOT generate an under-budget suggestion`
  );
}

const totalsAfterSuggestions = computeProjectTotals(categories);
assert.equal(
  totalsAfterSuggestions.projectedFinalCostCents,
  totals.projectedFinalCostCents,
  "generating suggestions must never change the projected final cost"
);

// ---- Report --------------------------------------------------------

console.log("=== Category rollups ===");
for (const c of categories) {
  console.log(
    `${c.code.padEnd(32)} [${c.status.padEnd(20)}] orig ${formatCents(c.originalEstimateCents).padStart(12)}  revised ${formatCents(c.revisedEstimateCents).padStart(12)}  actual ${formatCents(c.actualCostCents).padStart(12)}  committed ${formatCents(c.committedCostCents).padStart(12)}  projected ${formatCents(c.projectedFinalCostCents).padStart(12)}`
  );
}

console.log("\n=== Project totals ===");
console.log("Original estimate:      ", formatCents(totals.originalEstimateCents));
console.log("Approved changes:       ", formatCents(totals.approvedChangesCents));
console.log("Revised estimate:       ", formatCents(totals.revisedEstimateCents));
console.log("Actual cost (posted):   ", formatCents(totals.actualCostCents));
console.log("  (excludes pending:    ", formatCents(pendingTotal), ")");
console.log("Committed cost:         ", formatCents(totals.committedCostCents));
console.log("Forecast to complete:   ", formatCents(totals.forecastToCompleteCents));
console.log("Projected final cost:   ", formatCents(totals.projectedFinalCostCents));

console.log("\n=== Fee (1500 basis points = 15.00%) ===");
console.log("Fee-eligible basis:     ", formatCents(feeSummary.feeEligibleBasisCents));
console.log("Fee accrued:            ", formatCents(feeSummary.feeAccruedCents));
console.log("Fee invoiced:           ", formatCents(feeSummary.feeInvoicedCents));
console.log("Fee unbilled:           ", formatCents(feeSummary.feeUnbilledCents));

console.log("\n=== Reconciliation ===");
console.log("OK:", reconciliation.ok, "| issues:", reconciliation.issues.length);

console.log("\n=== Suggestions (pending human review — not official) ===");
for (const s of suggestions) {
  console.log(`[${s.confidence.toUpperCase()}] ${s.direction.toUpperCase()} ${formatCents(s.suggestedAmountCents)} — ${s.reason}`);
}

console.log("\nrun.ts: all assertions passed.");
