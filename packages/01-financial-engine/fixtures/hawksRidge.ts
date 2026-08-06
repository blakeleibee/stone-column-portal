// Shared sample data — "Hawks Ridge Residence" — used by BOTH the
// financial-engine's own test/run.ts AND the Package 2 UI's Financials
// screen. Single source so the numbers a developer sees in a test
// report and the numbers a reviewer sees in the UI prototype are
// always the same data, not two copies that can drift apart.
import {
  CostCode,
  CostCodeStatus,
  BudgetLedgerEntry,
  Expense,
  CommittedCost,
  ForecastEntry,
  FeeRule,
  FeeLedgerEntry,
} from "../src/types";

export const PROJECT_ID = "proj_hawksridge";

export const CODES = [
  "Preconstruction",
  "Permits & Professional Services",
  "Site Work",
  "Concrete & Foundation",
  "Framing",
  "Roofing",
  "Windows & Doors",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Insulation & Drywall",
  "Interior Trim & Cabinets",
  "Countertops & Tile",
  "Flooring & Painting",
  "Appliances & Fixtures",
  "Landscaping",
  "General Conditions",
  "Contingency / Other",
] as const;

const STATUS_BY_CODE: Record<(typeof CODES)[number], CostCodeStatus> = {
  "Preconstruction": "complete",
  "Permits & Professional Services": "complete",
  "Site Work": "complete",
  "Concrete & Foundation": "complete",
  "Framing": "active",
  "Roofing": "not_started",
  "Windows & Doors": "not_started",
  "Plumbing": "active",
  "Electrical": "active",
  "HVAC": "active",
  "Insulation & Drywall": "not_started",
  "Interior Trim & Cabinets": "not_started",
  "Countertops & Tile": "not_started",
  "Flooring & Painting": "not_started",
  "Appliances & Fixtures": "not_started",
  "Landscaping": "not_started",
  "General Conditions": "active",
  "Contingency / Other": "active",
};

export const costCodes: CostCode[] = CODES.map((code, i) => ({
  id: `cc_${i}`,
  projectId: PROJECT_ID,
  code,
  feeEligible: code !== "Contingency / Other",
  status: STATUS_BY_CODE[code],
  isArchived: false,
  // This fixture predates the P2.1 division/activity/scope columns and
  // was never seeded via apply_standard_cost_code_template() — null/true
  // defaults match what an ad hoc (non-templated) cost code looks like.
  divisionId: null,
  activityName: null,
  scopeDescription: null,
  includeInEstimate: true,
  billable: true,
}));

export const codeId = (code: string): string =>
  costCodes.find((c) => c.code === code)!.id;

const originalAmounts: Record<string, number> = {
  "Preconstruction": 4_500_000,
  "Permits & Professional Services": 6_000_000,
  "Site Work": 12_000_000,
  "Concrete & Foundation": 18_000_000,
  "Framing": 31_000_000,
  "Roofing": 9_500_000,
  "Windows & Doors": 14_000_000,
  "Plumbing": 13_000_000,
  "Electrical": 12_500_000,
  "HVAC": 11_000_000,
  "Insulation & Drywall": 12_500_000,
  "Interior Trim & Cabinets": 26_000_000,
  "Countertops & Tile": 15_000_000,
  "Flooring & Painting": 15_500_000,
  "Appliances & Fixtures": 11_000_000,
  "Landscaping": 8_500_000,
  "General Conditions": 7_000_000,
  "Contingency / Other": 6_000_000,
};

let ledgerSeq = 0;
export const budgetLedger: BudgetLedgerEntry[] = Object.entries(originalAmounts).map(
  ([code, amt]) => ({
    id: `bl_${ledgerSeq++}`,
    costCodeId: codeId(code),
    entryType: "original",
    amountCents: amt,
    sourceType: "initial_setup",
    createdAt: "2026-02-03T00:00:00Z",
  })
);

budgetLedger.push({
  id: `bl_${ledgerSeq++}`,
  costCodeId: codeId("Site Work"),
  entryType: "approved_change",
  amountCents: 150_000,
  sourceType: "change_order",
  createdAt: "2026-04-20T00:00:00Z",
});

export const expenses: Expense[] = [
  { id: "e1", projectId: PROJECT_ID, costCodeId: codeId("Preconstruction"), vendorName: "Stone Column", transactionDate: "2026-02-01", amountCents: 4_500_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Preconstruction services" },
  { id: "e2", projectId: PROJECT_ID, costCodeId: codeId("Permits & Professional Services"), vendorName: "Milton Building Dept", transactionDate: "2026-03-04", amountCents: 5_820_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Permits and design fees" },
  { id: "e3", projectId: PROJECT_ID, costCodeId: codeId("Site Work"), vendorName: "Ridgeline Excavation", transactionDate: "2026-06-02", amountCents: 4_820_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Site grading and pad preparation" },
  { id: "e4", projectId: PROJECT_ID, costCodeId: codeId("Site Work"), vendorName: "Apex Site Services", transactionDate: "2026-07-16", amountCents: 380_000, financialStatus: "pending", publicationStatus: "internal", descriptionClient: "Erosion control maintenance" },
  { id: "e5", projectId: PROJECT_ID, costCodeId: codeId("Concrete & Foundation"), vendorName: "Carter & Sons Concrete", transactionDate: "2026-06-09", amountCents: 6_100_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Foundation footings" },
  { id: "e6", projectId: PROJECT_ID, costCodeId: codeId("Concrete & Foundation"), vendorName: "Carter & Sons Concrete", transactionDate: "2026-06-21", amountCents: 9_720_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Foundation slab and walls" },
  { id: "e7", projectId: PROJECT_ID, costCodeId: codeId("Framing"), vendorName: "North Georgia Lumber Co.", transactionDate: "2026-07-03", amountCents: 11_200_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Structural framing materials" },
  { id: "e8", projectId: PROJECT_ID, costCodeId: codeId("Framing"), vendorName: "Summit Framing Crew", transactionDate: "2026-07-10", amountCents: 5_400_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Framing labor, first phase" },
  { id: "e9", projectId: PROJECT_ID, costCodeId: codeId("Framing"), vendorName: "North Georgia Lumber Co.", transactionDate: "2026-07-14", amountCents: 2_800_000, financialStatus: "pending", publicationStatus: "internal", descriptionClient: "Roof truss materials" },
  { id: "e10", projectId: PROJECT_ID, costCodeId: codeId("Plumbing"), vendorName: "Milton Plumbing Group", transactionDate: "2026-07-15", amountCents: 2_200_000, financialStatus: "posted", publicationStatus: "internal", descriptionClient: "Underground plumbing rough-in" },
  { id: "e11", projectId: PROJECT_ID, costCodeId: codeId("Electrical"), vendorName: "Bright Spark Electric", transactionDate: "2026-07-15", amountCents: 1_800_000, financialStatus: "posted", publicationStatus: "internal", descriptionClient: "Temporary power and utility service" },
  { id: "e12", projectId: PROJECT_ID, costCodeId: codeId("General Conditions"), vendorName: "Stone Column General Conditions", transactionDate: "2026-07-16", amountCents: 3_200_000, financialStatus: "posted", publicationStatus: "internal", descriptionClient: "Jobsite general conditions" },
  { id: "e13", projectId: PROJECT_ID, costCodeId: codeId("Contingency / Other"), vendorName: "Stone Column", transactionDate: "2026-07-01", amountCents: 420_000, financialStatus: "posted", publicationStatus: "published", descriptionClient: "Minor field adjustment" },
];

export const committedCosts: CommittedCost[] = [
  { id: "cm1", projectId: PROJECT_ID, costCodeId: codeId("Framing"), amountCents: 6_600_000, status: "open" },
];

export const forecastEntries: ForecastEntry[] = [
  { id: "f1", projectId: PROJECT_ID, costCodeId: codeId("HVAC"), forecastToCompleteCents: 12_100_000, method: "manual" },
];

export const feeRule: FeeRule = {
  id: "fee1",
  projectId: PROJECT_ID,
  feeBasis: "percentage",
  feeBasisPoints: 1500,
  contingencyFeeEligible: false,
  allowanceFeeEligible: true,
  effectiveFrom: "2026-01-22T00:00:00Z",
};

export const feeLedgerEntries: FeeLedgerEntry[] = [];

export const projectMeta = {
  id: PROJECT_ID,
  name: "Hawks Ridge Residence",
  projectNumber: "HR-001",
  address: "142 Hawks Ridge Trail, Milton, GA",
  phase: "Framing",
  clientNames: "Michael & Sarah Chen",
  pricingLabel: "Cost-Plus 15%",
};
