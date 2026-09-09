import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ImportWizard } from "../../../../../packages/02-app-shell/src/components/ImportWizard";
import { NoProjectSelected } from "../../../../../packages/02-app-shell/src/components/NoProjectSelected";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listMappingProfiles } from "../../../../../packages/02-app-shell/src/services/importMappingService";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";
import { switchProject } from "../projects/switchAction";
import { createMappingProfile } from "./mappingActions";
import {
  overrideImportRow,
  excludeImportRow,
  listImportRows,
  confirmImportBatch,
  getImportBatchReconciliation,
} from "./confirmActions";

/**
 * Resolves its project/switcher data via resolveSelectedProject()
 * (through the shared resolveProjectAndSwitcherData() helper), same as
 * /admin/estimate/page.tsx — Task 5 replaced this page's earlier ad hoc
 * "first project" query with this. Unlike that page, there is no
 * demo-mode/fixture fallback here: Task 9's `/api/imports/parse` Route
 * Handler always calls `canManageProject` and writes through a real
 * Supabase client (there is no fixture-repository equivalent for
 * import_batches/import_rows), so this screen is real-backend-only and
 * always requires a real authenticated admin/staff session, regardless
 * of DEMO_MODE.
 */
export default async function AdminImportPage() {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { project, switcherData } = await resolveProjectAndSwitcherData(supabase, user.orgId, user.role);

  if (!project) {
    return (
      <AdminChrome activeKey="import" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectSelected
          projects={switcherData.otherProjects}
          hasArchivedProjects={switcherData.hasArchivedProjects}
          onSelectProject={switchProject}
        />
      </AdminChrome>
    );
  }

  const [mappingProfiles, costCodes] = await Promise.all([
    listMappingProfiles(supabase, user.orgId),
    repo.getCostCodes(project.id),
  ]);

  return (
    <AdminChrome activeKey="import" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ImportWizard
        orgId={user.orgId}
        projectId={project.id}
        mappingProfiles={mappingProfiles}
        costCodes={costCodes}
        createMappingProfile={createMappingProfile}
        listImportRows={listImportRows}
        overrideImportRow={overrideImportRow}
        excludeImportRow={excludeImportRow}
        confirmImportBatch={confirmImportBatch}
        getImportBatchReconciliation={getImportBatchReconciliation}
      />
    </AdminChrome>
  );
}
