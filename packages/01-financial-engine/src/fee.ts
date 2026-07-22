import { CategoryFinancials, FeeRule, Expense, FeeLedgerEntry, ID, Cents } from "./types";
import { addCents, subtractCents, multiplyCentsByBasisPoints } from "./money";

export interface FeeAccrual {
  costCodeId: ID;
  feeEligibleBasisCents: Cents;
  feeAccruedCents: Cents;
}

/** ROUNDING POLICY: see the comment above multiplyCentsByBasisPoints in
 *  money.ts. Summary: eligible expenses for a category are summed first
 *  (exact, since they're already integer cents), and the fee rate is
 *  applied ONCE to that per-category sum via exact BigInt arithmetic —
 *  not once per expense, and never through a JS float percentage.
 *
 *  Fee is computed off ACTUAL (posted) cost only, on fee-eligible
 *  categories, respecting per-expense overrides (e.g. an owner-direct
 *  purchase routed through a normally-eligible category). This replaces
 *  the original prototype's `totalActual * fee` (no eligibility logic,
 *  float percentage). */
export function computeFeeAccrual(
  feeRule: FeeRule,
  categories: CategoryFinancials[],
  expenses: Expense[]
): FeeAccrual[] {
  return categories.map((cat) => {
    // CORRECTION (independent review item 3): only posted expenses ever
    // enter the fee basis — a pending expense is not yet real money and
    // must never accrue fee, even provisionally.
    const codeExpenses = expenses.filter(
      (e) => e.costCodeId === cat.costCodeId && e.financialStatus === "posted"
    );

    const eligibleBasisCents = addCents(
      ...codeExpenses
        .filter((e) => {
          // per-expense override wins; otherwise inherit the category's
          // fee-eligible flag already baked into CategoryFinancials.
          if (typeof e.feeEligibleOverride === "boolean") return e.feeEligibleOverride;
          return cat.isFeeEligible;
        })
        .map((e) => e.amountCents),
      0
    );

    const feeAccruedCents =
      feeRule.feeBasis === "percentage"
        ? multiplyCentsByBasisPoints(eligibleBasisCents, feeRule.feeBasisPoints ?? 0)
        : // fixed fee is a project-level amount, not per-category — attribute
          // it entirely to the project total in computeProjectFeeSummary,
          // not here (avoid double counting across categories).
          0;

    return {
      costCodeId: cat.costCodeId,
      feeEligibleBasisCents: eligibleBasisCents,
      feeAccruedCents,
    };
  });
}

export interface ProjectFeeSummary {
  feeEligibleBasisCents: Cents;
  feeAccruedCents: Cents;   // earned-to-date based on posted actual cost; sum of already-rounded per-category amounts
  feeInvoicedCents: Cents;  // net of fee_ledger 'invoice_issued' rows AND any reversal_adjustment rows against them
  feeUnbilledCents: Cents;  // accrued - invoiced; NOT the same as "money owed" (see invoices module, Package 4)
}

/** Nets a fee ledger down to a single total for a given source_type,
 *  honoring reversals: a reversal_adjustment row has reversesEntryId set
 *  and a (typically negative) feeAmountCents, and is simply summed in
 *  like any other row — the ledger is signed and additive by
 *  construction. This is also where "how is an incorrect fee-ledger
 *  entry reversed" is answered concretely: you never edit
 *  fee_amount_cents on an existing row (the DB trigger forbids it), you
 *  insert a new row with reversesEntryId set and source_type =
 *  'reversal_adjustment'. */
export function sumFeeLedgerBySourceType(
  entries: FeeLedgerEntry[],
  sourceType: FeeLedgerEntry["sourceType"]
): Cents {
  return addCents(
    ...entries.filter((e) => e.sourceType === sourceType).map((e) => e.feeAmountCents),
    0
  );
}

export function computeProjectFeeSummary(
  feeRule: FeeRule,
  categories: CategoryFinancials[],
  expenses: Expense[],
  feeLedgerEntries: FeeLedgerEntry[]
): ProjectFeeSummary {
  const perCategory = computeFeeAccrual(feeRule, categories, expenses);
  const feeEligibleBasisCents = addCents(...perCategory.map((c) => c.feeEligibleBasisCents), 0);

  const feeAccruedCents =
    feeRule.feeBasis === "fixed"
      ? feeRule.feeFixedAmountCents ?? 0
      : addCents(...perCategory.map((c) => c.feeAccruedCents), 0);

  const invoicedRaw = sumFeeLedgerBySourceType(feeLedgerEntries, "invoice_issued");
  const reversalsAgainstInvoiced = sumFeeLedgerBySourceType(feeLedgerEntries, "reversal_adjustment");
  const feeInvoicedCents = addCents(invoicedRaw, reversalsAgainstInvoiced);

  return {
    feeEligibleBasisCents,
    feeAccruedCents,
    feeInvoicedCents,
    feeUnbilledCents: subtractCents(feeAccruedCents, feeInvoicedCents),
  };
}
