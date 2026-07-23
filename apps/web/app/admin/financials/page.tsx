import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM, loadAdminVMFor } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";

export default async function AdminFinancialsPage() {
  if (isDemoMode()) {
    const adminVM = await loadAdminVM();
    return (
      <AdminChrome activeKey="financials">
        <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" />
      </AdminChrome>
    );
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
      <AdminChrome activeKey="financials">
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const adminVM = await loadAdminVMFor(firstProject.id, repo);
  return (
    <AdminChrome activeKey="financials">
      <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" />
    </AdminChrome>
  );
}
