import { AdminChrome } from "../../../src/shell/AdminChrome";
import { EstimateTable } from "../../../../../packages/02-app-shell/src/components/EstimateTable";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { computeAllCategoryFinancials } from "../../../../../packages/01-financial-engine/src/budget";
import { projectMeta as demoProjectMeta } from "../../../../../packages/01-financial-engine/fixtures/hawksRidge";
import type { FinancialRepository } from "../../../../../packages/02-app-shell/src/data/financialRepository";
import { enterOriginalBudget, adjustBudget } from "./actions";
import { updateCostCodeMetadata } from "./costCodeActions";

async function EstimatePageBody({
  projectId,
  repo,
  demo,
}: {
  projectId: string;
  repo: FinancialRepository;
  demo: boolean;
}) {
  // Fetch every input computeAllCategoryFinancials needs, through the
  // repository's existing methods — never a raw ad hoc query duplicating
  // what the repository already does (same rule buildAdminFinancialsViewModel
  // follows).
  const [costCodes, budgetLedger, expenses, committedCosts, forecastEntries] = await Promise.all([
    repo.getCostCodes(projectId),
    repo.getBudgetLedger(projectId),
    repo.getExpenses(projectId),
    repo.getCommittedCosts(projectId),
    repo.getForecastEntries(projectId),
  ]);

  const categories = computeAllCategoryFinancials(costCodes, budgetLedger, expenses, committedCosts, forecastEntries);

  // Explicit per-cost-code flag for "does an original entry already
  // exist," computed directly from the raw ledger rows — NOT inferred
  // from originalEstimateCents === 0, since a legitimate original entry
  // of exactly $0 is valid and would otherwise be indistinguishable from
  // "no entry yet."
  const hasOriginalEntry: Record<string, boolean> = {};
  for (const costCode of costCodes) {
    hasOriginalEntry[costCode.id] = budgetLedger.some(
      (entry) => entry.costCodeId === costCode.id && entry.entryType === "original"
    );
  }

  return (
    <AdminChrome activeKey="financials" isDemoMode={demo}>
      <EstimateTable
        categories={categories}
        costCodes={costCodes}
        hasOriginalEntry={hasOriginalEntry}
        projectId={projectId}
        enterOriginalBudget={enterOriginalBudget}
        adjustBudget={adjustBudget}
        updateCostCodeMetadata={updateCostCodeMetadata}
      />
    </AdminChrome>
  );
}

export default async function AdminEstimatePage() {
  if (isDemoMode()) {
    const repo = getRepository(null);
    return <EstimatePageBody projectId={demoProjectMeta.id} repo={repo} demo />;
  }

  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { data: firstProject } = await supabase
    .from("projects")
    .select("id")
    .eq("org_id", user.orgId)
    .limit(1)
    .maybeSingle();

  if (!firstProject) {
    return (
      <AdminChrome activeKey="financials" isDemoMode={isDemoMode()}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  return <EstimatePageBody projectId={firstProject.id} repo={repo} demo={false} />;
}
