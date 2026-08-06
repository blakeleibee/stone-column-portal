/**
 * Edge-case tests for Package 1. Run with: npx ts-node test/edge_cases.ts
 */
import {
  CostCode,
  BudgetLedgerEntry,
  Expense,
  CommittedCost,
  ForecastEntry,
  FeeRule,
  computeCategoryFinancials,
  computeAllCategoryFinancials,
  computeProjectTotals,
  computeProjectFeeSummary,
  reconcileProject,
  generateBudgetSuggestions,
  multiplyCentsByBasisPoints,
  parseCentsFromApi,
  serializeCentsForApi,
} from "../src";

const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected) throw new Error(message ?? `Expected ${expected}, got ${actual}`);
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? `Expected truthy value, got ${value}`);
  },
  throws(fn: () => void, message?: string) {
    try {
      fn();
    } catch {
      return;
    }
    throw new Error(message ?? "Expected function to throw, but it did not");
  },
};

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok — ${name}`);
}

function makeCode(overrides: Partial<CostCode> = {}): CostCode {
  return {
    id: "cc1",
    projectId: "p1",
    code: "Test Category",
    feeEligible: true,
    status: "active",
    isArchived: false,
    divisionId: null,
    activityName: null,
    scopeDescription: null,
    includeInEstimate: true,
    billable: true,
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> & Pick<Expense, "id" | "costCodeId" | "amountCents">): Expense {
  return {
    projectId: "p1",
    vendorName: "V",
    transactionDate: "2026-01-01",
    financialStatus: "posted",
    publicationStatus: "internal",
    ...overrides,
  };
}

// =====================================================================
console.log("\n--- 1. Credits and negative ledger entries ---");
{
  const cc = makeCode();
  const ledger: BudgetLedgerEntry[] = [
    { id: "l1", costCodeId: cc.id, entryType: "original", amountCents: 1_000_00, sourceType: "initial_setup", createdAt: "2026-01-01" },
    { id: "l2", costCodeId: cc.id, entryType: "approved_change", amountCents: -200_00, sourceType: "change_order", createdAt: "2026-02-01" },
  ];
  const result = computeCategoryFinancials(cc, ledger, [], [], []);
  check("negative approved change reduces revised estimate", () => {
    assert.equal(result.originalEstimateCents, 100_000);
    assert.equal(result.approvedChangesCents, -20_000);
    assert.equal(result.revisedEstimateCents, 80_000);
  });
}

// =====================================================================
console.log("\n--- 2. Refunds ---");
{
  const cc = makeCode();
  const expenses: Expense[] = [
    makeExpense({ id: "e1", costCodeId: cc.id, amountCents: 500_00 }),
    makeExpense({ id: "e2", costCodeId: cc.id, amountCents: -75_00, descriptionClient: "Refund — returned material" }),
  ];
  const result = computeCategoryFinancials(cc, [], expenses, [], []);
  check("refund (negative posted expense) reduces actual cost", () => {
    assert.equal(result.actualCostCents, 425_00);
  });
}

// =====================================================================
console.log("\n--- 3. Pending vs. posted vs. void expenses ---");
{
  const cc = makeCode();
  const expenses: Expense[] = [
    makeExpense({ id: "e1", costCodeId: cc.id, amountCents: 500_00, financialStatus: "posted" }),
    makeExpense({ id: "e2", costCodeId: cc.id, amountCents: 999_00, financialStatus: "pending" }),
    makeExpense({ id: "e3", costCodeId: cc.id, amountCents: 250_00, financialStatus: "void", publicationStatus: "withdrawn" }),
    makeExpense({ id: "e4", costCodeId: cc.id, amountCents: 250_00, financialStatus: "posted", correctsExpenseId: "e3" }),
  ];
  const result = computeCategoryFinancials(cc, [], expenses, [], []);
  check("pending expense excluded from actual cost", () => {
    assert.equal(result.actualCostCents, 500_00 + 250_00); // e1 + e4 only, NOT e2 (pending) or e3 (void)
  });
  check("void expense row itself is preserved, not deleted", () => {
    assert.ok(expenses.some((e) => e.id === "e3" && e.financialStatus === "void"));
  });
}

// =====================================================================
console.log("\n--- 4. Fee-eligible vs. fee-exempt costs (and pending exclusion) ---");
{
  const eligibleCode = makeCode({ id: "cc_elig", feeEligible: true });
  const exemptCode = makeCode({ id: "cc_exempt", code: "Contingency", feeEligible: false });
  const expenses: Expense[] = [
    makeExpense({ id: "e1", costCodeId: eligibleCode.id, amountCents: 1_000_00 }),
    makeExpense({ id: "e2", costCodeId: exemptCode.id, amountCents: 1_000_00 }),
    makeExpense({ id: "e3", costCodeId: eligibleCode.id, amountCents: 400_00, feeEligibleOverride: false }),
    // Pending — must not enter the fee basis even though the category is eligible.
    makeExpense({ id: "e4", costCodeId: eligibleCode.id, amountCents: 5_000_00, financialStatus: "pending" }),
  ];
  const categories = computeAllCategoryFinancials([eligibleCode, exemptCode], [], expenses, [], []);
  const feeRule: FeeRule = { id: "f1", projectId: "p1", feeBasis: "percentage", feeBasisPoints: 1000, contingencyFeeEligible: false, allowanceFeeEligible: true, effectiveFrom: "2026-01-01" };
  const summary = computeProjectFeeSummary(feeRule, categories, expenses, []);
  check("fee basis excludes fee-exempt category, per-expense override, AND pending expenses", () => {
    assert.equal(summary.feeEligibleBasisCents, 1_000_00);
    assert.equal(summary.feeAccruedCents, 100_00);
  });
}

// =====================================================================
console.log("\n--- 5. Basis-point rounding: unusual rates, negative credits, half-cent, large safe values ---");
{
  check("round-half-away-from-zero: positive fractional bp rounds up", () => {
    // 33 cents * 1500bp/10000 = 4.95 -> rounds to 5
    assert.equal(multiplyCentsByBasisPoints(33, 1500), 5);
  });
  check("exact half-cent rounds up in magnitude (positive)", () => {
    // 10 cents * 500bp/10000 = 0.5 -> rounds to 1
    assert.equal(multiplyCentsByBasisPoints(10, 500), 1);
  });
  check("exact half-cent rounds up in magnitude (negative basis / credit)", () => {
    assert.equal(multiplyCentsByBasisPoints(-10, 500), -1);
  });
  check("unusual rate: 1 basis point (0.01%)", () => {
    assert.equal(multiplyCentsByBasisPoints(1_000_000, 1), 100); // $10,000 * 0.01% = $1.00
  });
  check("unusual rate: rate exceeding 100% (9999 or higher bp) still computes exactly", () => {
    // Not a realistic contractor fee, but the math itself must not break.
    // $100.00 (10000 cents) at 15000bp (150%) = $150.00 (15000 cents).
    assert.equal(multiplyCentsByBasisPoints(100_00, 15000), 150_00);
  });
  check("one-cent basis with tiny rate rounds to zero, not a fraction", () => {
    assert.equal(multiplyCentsByBasisPoints(1, 1), 0); // 1 cent * 1bp/10000 = 0.0001 -> 0
  });
  check("large safe value: no precision loss near Number.MAX_SAFE_INTEGER", () => {
    // 90 trillion dollars in cents (absurd, but tests the BigInt path
    // actually protects against float precision loss at scale).
    const bigCents = 9_000_000_000_000_00; // $90 trillion
    const result = multiplyCentsByBasisPoints(bigCents, 1500);
    // Verify against an independent BigInt computation, not the
    // function under test, and confirm it's still a safe integer.
    const expected = (BigInt(bigCents) * 1500n) / 10000n; // evenly divisible, no rounding needed
    assert.equal(result, Number(expected));
    assert.ok(Number.isSafeInteger(result));
  });
  check("category-level rounding happens once, not per-transaction", () => {
    // Three 1-cent expenses at 5000bp (50%): per-transaction rounding
    // would give round(0.5)+round(0.5)+round(0.5) = 1+1+1 = 3; summed-
    // first-then-rounded-once gives round(3 * 0.5) = round(1.5) = 2.
    const cc = makeCode();
    const expenses: Expense[] = [
      makeExpense({ id: "e1", costCodeId: cc.id, amountCents: 1 }),
      makeExpense({ id: "e2", costCodeId: cc.id, amountCents: 1 }),
      makeExpense({ id: "e3", costCodeId: cc.id, amountCents: 1 }),
    ];
    const categories = computeAllCategoryFinancials([cc], [], expenses, [], []);
    const feeRule: FeeRule = { id: "f1", projectId: "p1", feeBasis: "percentage", feeBasisPoints: 5000, contingencyFeeEligible: false, allowanceFeeEligible: true, effectiveFrom: "2026-01-01" };
    const summary = computeProjectFeeSummary(feeRule, categories, expenses, []);
    assert.equal(summary.feeEligibleBasisCents, 3);
    assert.equal(summary.feeAccruedCents, 2);
  });
  check("basis points must be an integer — rejects a float", () => {
    assert.throws(() => multiplyCentsByBasisPoints(100_00, 15.5 as unknown as number));
  });
}

// =====================================================================
console.log("\n--- 6. Approved positive and negative budget changes ---");
{
  const cc = makeCode();
  const ledger: BudgetLedgerEntry[] = [
    { id: "l1", costCodeId: cc.id, entryType: "original", amountCents: 500_00, sourceType: "initial_setup", createdAt: "2026-01-01" },
    { id: "l2", costCodeId: cc.id, entryType: "approved_change", amountCents: 100_00, sourceType: "change_order", createdAt: "2026-02-01" },
    { id: "l3", costCodeId: cc.id, entryType: "approved_change", amountCents: -30_00, sourceType: "change_order", createdAt: "2026-03-01" },
  ];
  const result = computeCategoryFinancials(cc, ledger, [], [], []);
  check("mixed positive and negative approved changes net correctly", () => {
    assert.equal(result.approvedChangesCents, 70_00);
    assert.equal(result.revisedEstimateCents, 570_00);
  });
}

// =====================================================================
console.log("\n--- 7. Zero-dollar categories ---");
{
  const cc = makeCode({ status: "not_started" });
  const result = computeCategoryFinancials(cc, [], [], [], []);
  check("all-zero category computes cleanly with no NaN/undefined", () => {
    assert.equal(result.originalEstimateCents, 0);
    assert.equal(result.revisedEstimateCents, 0);
    assert.equal(result.actualCostCents, 0);
    assert.equal(result.projectedFinalCostCents, 0);
    assert.equal(result.suggestedVarianceCents, 0);
  });
  check("zero-dollar category generates no suggestions", () => {
    assert.equal(generateBudgetSuggestions([result]).length, 0);
  });
}

// =====================================================================
console.log("\n--- 8. Actual costs exceeding the revised estimate ---");
{
  const cc = makeCode();
  const ledger: BudgetLedgerEntry[] = [
    { id: "l1", costCodeId: cc.id, entryType: "original", amountCents: 100_00, sourceType: "initial_setup", createdAt: "2026-01-01" },
  ];
  const expenses: Expense[] = [makeExpense({ id: "e1", costCodeId: cc.id, amountCents: 150_00 })];
  const result = computeCategoryFinancials(cc, ledger, expenses, [], []);
  check("over-budget category has positive suggested variance", () => {
    assert.equal(result.suggestedVarianceCents, 50_00);
  });
  const suggestions = generateBudgetSuggestions([result]);
  check("over-budget category generates a high-confidence 'over' suggestion", () => {
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].direction, "over");
    assert.equal(suggestions[0].suggestedAmountCents, 50_00);
    assert.equal(suggestions[0].confidence, "high");
  });
}

// =====================================================================
console.log("\n--- 9. Commitments partially invoiced ---");
{
  const cc = makeCode();
  const supersededOriginal: CommittedCost = {
    id: "cm1", projectId: "p1", costCodeId: cc.id, amountCents: 1_000_00, status: "open",
    supersededAt: "2026-04-01T00:00:00Z", supersededById: "cm2",
  };
  const remainingCommitment: CommittedCost = {
    id: "cm2", projectId: "p1", costCodeId: cc.id, amountCents: 400_00, status: "open",
  };
  const expenses: Expense[] = [makeExpense({ id: "e1", costCodeId: cc.id, amountCents: 600_00 })];
  const result = computeCategoryFinancials(cc, [], expenses, [supersededOriginal, remainingCommitment], []);
  check("superseded commitment excluded; remaining balance + actual match the original total, no double counting", () => {
    assert.equal(result.actualCostCents, 600_00);
    assert.equal(result.committedCostCents, 400_00);
    assert.equal(result.projectedFinalCostCents, 1_000_00);
  });
}

// =====================================================================
console.log("\n--- 10. Forecast replacement without double counting ---");
{
  const cc = makeCode();
  const oldForecast: ForecastEntry = {
    id: "f1", projectId: "p1", costCodeId: cc.id, forecastToCompleteCents: 500_00, method: "manual",
    supersededAt: "2026-05-01T00:00:00Z",
  };
  const newForecast: ForecastEntry = {
    id: "f2", projectId: "p1", costCodeId: cc.id, forecastToCompleteCents: 300_00, method: "manual",
  };
  const result = computeCategoryFinancials(cc, [], [], [], [oldForecast, newForecast]);
  check("only the active (non-superseded) forecast counts", () => {
    assert.equal(result.forecastToCompleteCents, 300_00);
  });
}

// =====================================================================
console.log("\n--- 11. Dismissed vs. accepted suggestions ---");
{
  const cc = makeCode({ status: "complete" });
  const ledger: BudgetLedgerEntry[] = [
    { id: "l1", costCodeId: cc.id, entryType: "original", amountCents: 1_000_00, sourceType: "initial_setup", createdAt: "2026-01-01" },
  ];
  const expenses: Expense[] = [makeExpense({ id: "e1", costCodeId: cc.id, amountCents: 800_00 })];
  const before = computeCategoryFinancials(cc, ledger, expenses, [], []);
  const suggestions = generateBudgetSuggestions([before]);
  assert.equal(suggestions.length, 1);

  const afterDismiss = computeCategoryFinancials(cc, ledger, expenses, [], []);
  check("dismissed suggestion leaves projected final cost unchanged", () => {
    assert.equal(afterDismiss.projectedFinalCostCents, before.projectedFinalCostCents);
  });

  const acceptedForecast: ForecastEntry = {
    id: "f_accepted", projectId: "p1", costCodeId: cc.id, forecastToCompleteCents: 0, method: "accepted_suggestion",
  };
  const afterAccept = computeCategoryFinancials(cc, ledger, expenses, [], [acceptedForecast]);
  check("accepting a suggestion (via a real forecast_entries row) is what changes the number", () => {
    assert.equal(afterAccept.forecastToCompleteCents, 0);
    assert.equal(afterAccept.projectedFinalCostCents, 800_00);
  });
}

// =====================================================================
console.log("\n--- 12. Deliberately unreconciled ledger records ---");
{
  const good = computeCategoryFinancials(makeCode({ id: "cc_good" }), [
    { id: "l1", costCodeId: "cc_good", entryType: "original", amountCents: 100_00, sourceType: "initial_setup", createdAt: "2026-01-01" },
  ], [], [], []);

  const broken = { ...good, revisedEstimateCents: good.revisedEstimateCents + 500 };
  const report = reconcileProject([broken]);
  check("per-category check catches a fabricated revised estimate", () => {
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.message.includes("Revised estimate")));
  });

  const brokenProjected = { ...good, projectedFinalCostCents: good.projectedFinalCostCents + 1 };
  const report2 = reconcileProject([brokenProjected]);
  check("per-category check catches a fabricated projected final cost", () => {
    assert.equal(report2.ok, false);
    assert.ok(report2.issues.some((i) => i.message.includes("Projected final cost")));
  });
}

// =====================================================================
console.log("\n--- 13. BIGINT / API boundary safety ---");
{
  check("parses a bigint-as-string from the API correctly", () => {
    assert.equal(parseCentsFromApi("123456"), 123456);
  });
  check("accepts a plain number too", () => {
    assert.equal(parseCentsFromApi(500), 500);
  });
  check("rejects a non-digit string", () => {
    assert.throws(() => parseCentsFromApi("12.50"));
    assert.throws(() => parseCentsFromApi("abc"));
  });
  check("rejects a value beyond Number.MAX_SAFE_INTEGER", () => {
    assert.throws(() => parseCentsFromApi("9007199254740993"));
  });
  check("serializes back to a digit string for the wire", () => {
    assert.equal(serializeCentsForApi(123456), "123456");
    assert.equal(serializeCentsForApi(-500), "-500");
  });
}

// =====================================================================
console.log("\n--- 14. Cross-project reference integrity (engine-level note) ---");
{
  // The financial engine operates on arrays already scoped to a single
  // project by its caller — it has no notion of "which project" beyond
  // what's in the data it's given, so it cannot itself reject a
  // cross-project cost_code_id/project_id mismatch. That enforcement is
  // the composite foreign keys in schema/001_core_financial.sql
  // (expenses_cost_code_project_fk, committed_costs_cost_code_project_fk,
  // etc.), which make such a row impossible to insert in the first
  // place — see tests/sql/cross_project_integrity.sql for the
  // (unexecuted in this sandbox — see docs) database-level test. This
  // block just documents that fact so it isn't mistaken for something
  // the TypeScript layer is supposed to catch.
  check("documented: cross-project integrity is a DB-level guarantee, not a TS-level one", () => {
    assert.ok(true);
  });
}

console.log(`\nedge_cases.ts: all ${passed} checks passed.`);
