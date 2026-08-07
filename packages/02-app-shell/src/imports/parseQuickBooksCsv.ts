/**
 * Pure CSV parsing/matching logic for the QuickBooks job-cost import
 * pipeline (Package P4). No I/O, no database, no Next.js dependencies —
 * takes raw file contents and a match context, returns a plain array of
 * parsed rows with a resolved match status. Called by
 * `stageImportBatch()` (packages/02-app-shell/src/services/importService.ts),
 * which is responsible for turning ParsedImportRow[] into a staged
 * import batch and (on confirmation) real ledger writes.
 *
 * Lives in packages/02-app-shell (not apps/web) because stageImportBatch
 * — a DI-seam service function a future AI tool-calling layer must be
 * able to call directly per docs/production-build/AI-ASSISTANT-ARCHITECTURE.md
 * — needs this module, and packages/* must never depend on apps/web
 * (apps/web depends on packages/*, never the reverse). Originally lived
 * at apps/web/src/server/imports/parseQuickBooksCsv.ts; moved here
 * during the P4 final-review fix wave when the Route Handler's
 * business logic was extracted into a real service function.
 */
import { parse } from "csv-parse/sync";

export interface ParsedImportRow {
  rowNumber: number;
  rawData: Record<string, string>;
  resolvedCostCodeId: string | null;
  matchStatus: "new" | "changed" | "duplicate" | "unmatched" | "error";
  errorMessage?: string;
  /**
   * The row's Amount column, canonicalized to a signed integer number of
   * cents — the ONE place in the whole import pipeline Amount is ever
   * parsed. Handles QuickBooks' common export conventions: a leading
   * currency symbol and/or thousands separators ("$1,234.56"), and
   * parenthesized negatives for credits ("(500.00)" -> -50000). Callers
   * (stageImportBatch) store this value verbatim (as a string) in
   * raw_data.Amount — never the raw CSV string — so every downstream
   * reader (confirm_import_batch(), getImportBatchReconciliation())
   * reads one unambiguous integer-cents value with no re-parsing of a
   * decimal string required. May be NaN when the source value could not
   * be parsed at all (see matchStatus 'error').
   */
  amountCents: number;
}

export interface MatchContext {
  mappingProfile: {
    columnMapping: Record<string, string>;
    costCodeMatchStrategy: string;
    costCodePrefixLength: number | null;
    itemOverrides: Record<string, string>;
  };
  projectCostCodes: { id: string; code: string }[];
  existingExpenseKeys: Set<string>; // "vendorName|transactionDate|amountCents|costCodeId"
}

function resolveCostCodeId(itemValue: string, ctx: MatchContext): string | null {
  const override = ctx.mappingProfile.itemOverrides[itemValue];
  if (override) {
    return ctx.projectCostCodes.find((c) => c.code === override)?.id ?? null;
  }
  if (ctx.mappingProfile.costCodeMatchStrategy === "exact") {
    return ctx.projectCostCodes.find((c) => c.code === itemValue.trim())?.id ?? null;
  }
  if (ctx.mappingProfile.costCodeMatchStrategy === "prefix") {
    const len = ctx.mappingProfile.costCodePrefixLength ?? 4;
    const prefix = itemValue.trim().slice(0, len);
    return ctx.projectCostCodes.find((c) => c.code === prefix)?.id ?? null;
  }
  return null; // 'manual_only' — always requires a human to assign
}

/**
 * Canonicalizes a QuickBooks Amount cell to a signed integer number of
 * cents. Parenthesized-negative detection MUST happen before stripping
 * non-numeric characters — stripping first would discard the
 * parentheses and silently turn a QuickBooks credit (e.g. "(500.00)")
 * into a positive amount.
 */
function parseAmountToCents(amountRaw: string): number {
  const trimmed = amountRaw.trim();
  const isParenthesizedNegative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const unwrapped = isParenthesizedNegative ? trimmed.slice(1, -1) : trimmed;
  const numericString = unwrapped.replace(/[^0-9.-]/g, "");
  const magnitude = Math.round(parseFloat(numericString) * 100);
  return isParenthesizedNegative ? -magnitude : magnitude;
}

export function parseQuickBooksCsv(fileContents: string, ctx: MatchContext): ParsedImportRow[] {
  const records: Record<string, string>[] = parse(fileContents, {
    columns: true,
    skip_empty_lines: true,
  });

  const seenInFile = new Set<string>();
  const { item, vendor, amount, date } = ctx.mappingProfile.columnMapping;

  return records.map((raw, index) => {
    const rowNumber = index + 1;
    const itemValue = raw[item] ?? "";
    const vendorValue = raw[vendor] ?? "";
    const dateValue = raw[date] ?? "";
    const amountRaw = raw[amount] ?? "";
    const amountCents = parseAmountToCents(amountRaw);

    if (!Number.isFinite(amountCents) || !dateValue) {
      return {
        rowNumber,
        rawData: raw,
        resolvedCostCodeId: null,
        matchStatus: "error",
        errorMessage: `Row ${rowNumber}: could not parse amount or date.`,
        amountCents,
      };
    }

    const resolvedCostCodeId = resolveCostCodeId(itemValue, ctx);
    const key = `${vendorValue}|${dateValue}|${amountCents}|${resolvedCostCodeId}`;

    if (ctx.existingExpenseKeys.has(key) || seenInFile.has(key)) {
      return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "duplicate", amountCents };
    }
    seenInFile.add(key);

    if (!resolvedCostCodeId) {
      return { rowNumber, rawData: raw, resolvedCostCodeId: null, matchStatus: "unmatched", amountCents };
    }

    return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "new", amountCents };
  });
}
