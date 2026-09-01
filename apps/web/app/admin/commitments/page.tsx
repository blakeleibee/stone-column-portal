import { AdminChrome } from "../../../src/shell/AdminChrome";
import { CommitmentsTable } from "../../../../../packages/02-app-shell/src/components/CommitmentsTable";
import { PageHeader } from "../../../../../packages/02-app-shell/src/components/ui";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { projectMeta as demoProjectMeta } from "../../../../../packages/01-financial-engine/fixtures/hawksRidge";
import type { FinancialRepository } from "../../../../../packages/02-app-shell/src/data/financialRepository";
import { resolveProjectAndSwitcherData, type ResolvedProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";
import { supersedeCommittedCost } from "./actions";

/**
 * Same demo/real dual-path shape as /admin/estimate/page.tsx (an
 * `isDemoMode()` check up front, a shared body function taking
 * `projectId`/`repo`/`demo`/`projectSwitcherData`) — unlike /admin/bids,
 * which is real-backend-only with no demo fallback, committed_costs DOES
 * have a real fixture equivalent (`hawksRidge.committedCosts`), and
 * `getCommittedCosts` already works against both
 * `SupabaseFinancialRepository` and `FixtureFinancialRepository`.
 */
async function CommitmentsPageBody({
  projectId,
  repo,
  demo,
  projectSwitcherData,
}: {
  projectId: string;
  repo: FinancialRepository;
  demo: boolean;
  projectSwitcherData?: ResolvedProjectAndSwitcherData["switcherData"];
}) {
  // Fetched through the repository's existing methods, same discipline
  // as /admin/estimate's own body function — never a raw ad hoc query
  // duplicating what the repository already does.
  const [committedCosts, costCodes] = await Promise.all([
    repo.getCommittedCosts(projectId),
    repo.getCostCodes(projectId),
  ]);

  return (
    <AdminChrome activeKey="commitments" isDemoMode={demo} projectSwitcherData={projectSwitcherData}>
      <div style={{ padding: 24 }}>
        <PageHeader
          title="Commitments"
          subtitle="Open committed costs from awarded bids and material orders."
        />
        <CommitmentsTable
          committedCosts={committedCosts}
          costCodes={costCodes}
          supersedeCommittedCost={supersedeCommittedCost}
        />
      </div>
    </AdminChrome>
  );
}

export default async function AdminCommitmentsPage() {
  if (isDemoMode()) {
    const repo = getRepository(null);
    return <CommitmentsPageBody projectId={demoProjectMeta.id} repo={repo} demo />;
  }

  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { project, switcherData } = await resolveProjectAndSwitcherData(supabase, user.orgId, user.role);

  if (!project) {
    return (
      <AdminChrome activeKey="commitments" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  return <CommitmentsPageBody projectId={project.id} repo={repo} demo={false} projectSwitcherData={switcherData} />;
}
