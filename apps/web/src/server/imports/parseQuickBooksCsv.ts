/**
 * Pure CSV parsing/matching logic for the QuickBooks job-cost import
 * pipeline (Package P4). No I/O, no database, no Next.js dependencies —
 * takes raw file contents and a match context, returns a plain array of
 * parsed rows with a resolved match status. Called by the Task 9 Route
 * Handler, which is responsible for turning ParsedImportRow[] into a
 * staged import batch and (on confirmation) real ledger writes.
 */
import { parse } from "csv-parse/sync";

export interface ParsedImportRow {
  rowNumber: number;
  rawData: Record<string, string>;
  resolvedCostCodeId: string | null;
  matchStatus: "new" | "changed" | "duplicate" | "unmatched" | "error";
  errorMessage?: string;
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
    const amountCents = Math.round(parseFloat(amountRaw.replace(/[^0-9.-]/g, "")) * 100);

    if (!Number.isFinite(amountCents) || !dateValue) {
      return {
        rowNumber,
        rawData: raw,
        resolvedCostCodeId: null,
        matchStatus: "error",
        errorMessage: `Row ${rowNumber}: could not parse amount or date.`,
      };
    }

    const resolvedCostCodeId = resolveCostCodeId(itemValue, ctx);
    const key = `${vendorValue}|${dateValue}|${amountCents}|${resolvedCostCodeId}`;

    if (ctx.existingExpenseKeys.has(key) || seenInFile.has(key)) {
      return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "duplicate" };
    }
    seenInFile.add(key);

    if (!resolvedCostCodeId) {
      return { rowNumber, rawData: raw, resolvedCostCodeId: null, matchStatus: "unmatched" };
    }

    return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "new" };
  });
}
