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
  /**
   * The row's Date column, canonicalized to a strict ISO `YYYY-MM-DD`
   * string — the ONE place in the whole import pipeline Date is ever
   * parsed. Handles QuickBooks Desktop's own export conventions: strict
   * ISO (already canonical) and its default `MM/DD/YYYY` / `M/D/YYYY`
   * US slash format. Callers (stageImportBatch) store this value
   * verbatim in raw_data.Date — never the raw CSV string — so the
   * duplicate-detection key built here lines up with
   * `expenses.transaction_date`, which PostgREST always returns in
   * canonical `YYYY-MM-DD` regardless of how it was written. Without
   * this, a cross-import duplicate check comparing a raw `MM/DD/YYYY`
   * CSV string against Postgres's `YYYY-MM-DD` would never match, even
   * for the exact same underlying date (P4 post-closeout fix — see
   * docs/milestones/P4-complete.md's former "Known Limitations" entry
   * on this). Null when the source value is empty, unrecognized, or
   * does not represent a real calendar date (e.g. "02/30/2026" — Feb
   * 30th does not exist) — see matchStatus 'error'.
   */
  canonicalDate: string | null;
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

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** True calendar validation, not just a regex shape check — rejects
 *  month 13, day 32, and day-of-month overflows that vary by month/leap
 *  year (e.g. "02/30/2026", "04/31/2026", "02/29/2027" in a non-leap
 *  year), rather than silently normalizing a garbage date. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Canonicalizes a QuickBooks Date cell to a strict ISO `YYYY-MM-DD`
 * string — the ONE place in the whole import pipeline Date is ever
 * parsed. Recognizes strict ISO (`YYYY-MM-DD`, already canonical, zero-
 * padded) and QuickBooks Desktop's default export convention, US slash
 * format (`M/D/YYYY` or `MM/DD/YYYY`, 1-or-2-digit month/day, 4-digit
 * year). Returns null — never a best-effort guess — for anything that
 * doesn't match one of those two shapes, or that matches the shape but
 * doesn't represent a real calendar date (month 13, day 32, Feb 30th,
 * etc.). Mirrors `parseAmountToCents`'s role exactly: callers
 * (stageImportBatch) store this value, never the raw CSV string, so
 * every downstream reader — including the duplicate-detection key built
 * in this file — compares one unambiguous date format, never a
 * re-parsed or format-mismatched string.
 */
function parseQuickBooksDate(dateRaw: string): string | null {
  const trimmed = dateRaw.trim();

  const isoMatch = ISO_DATE_RE.exec(trimmed);
  if (isoMatch) {
    const [, yearStr, monthStr, dayStr] = isoMatch;
    if (!isValidCalendarDate(Number(yearStr), Number(monthStr), Number(dayStr))) {
      return null;
    }
    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  const usMatch = US_SLASH_DATE_RE.exec(trimmed);
  if (usMatch) {
    const [, monthStr, dayStr, yearStr] = usMatch;
    const month = Number(monthStr);
    const day = Number(dayStr);
    const year = Number(yearStr);
    if (!isValidCalendarDate(year, month, day)) {
      return null;
    }
    return `${yearStr}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
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
    const canonicalDate = dateValue ? parseQuickBooksDate(dateValue) : null;

    if (!Number.isFinite(amountCents) || !canonicalDate) {
      const amountFailed = !Number.isFinite(amountCents);
      const dateFailed = !canonicalDate;
      const errorMessage =
        amountFailed && dateFailed
          ? `Row ${rowNumber}: could not parse amount or date.`
          : amountFailed
            ? `Row ${rowNumber}: could not parse amount.`
            : `Row ${rowNumber}: could not parse date.`;
      return {
        rowNumber,
        rawData: raw,
        resolvedCostCodeId: null,
        matchStatus: "error",
        errorMessage,
        amountCents,
        canonicalDate,
      };
    }

    const resolvedCostCodeId = resolveCostCodeId(itemValue, ctx);
    const key = `${vendorValue}|${canonicalDate}|${amountCents}|${resolvedCostCodeId}`;

    if (ctx.existingExpenseKeys.has(key) || seenInFile.has(key)) {
      return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "duplicate", amountCents, canonicalDate };
    }
    seenInFile.add(key);

    if (!resolvedCostCodeId) {
      return { rowNumber, rawData: raw, resolvedCostCodeId: null, matchStatus: "unmatched", amountCents, canonicalDate };
    }

    return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "new", amountCents, canonicalDate };
  });
}
