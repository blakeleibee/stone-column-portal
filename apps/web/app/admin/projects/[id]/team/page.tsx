import { AdminChrome } from "../../../../../src/shell/AdminChrome";
import { ProjectTeamWorkspace } from "../../../../../../../packages/02-app-shell/src/components/ProjectTeamWorkspace";
import { NoProjectAccess } from "../../../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../../../src/server/demoMode";
import { requireRole } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import {
  listAccessibleProjects,
  listProjectStaffAssignments,
  listProjectMembers,
  type ProjectStaffAssignmentRow,
} from "../../../../../../../packages/02-app-shell/src/services/projectService";
import { assignStaff, revokeAssignment, reactivateAssignment, refreshAssignments } from "./actions";

/**
 * Task 6 (P3): per-project team-management screen. Reached from
 * /admin/projects (Task 4's real project list, which links each row to
 * this route — see ProjectListWorkspace.tsx) rather than its own
 * top-level nav entry; `activeKey="projects"` keeps the Projects nav tab
 * highlighted, matching how this route is a child of that screen, not a
 * sibling. Real-backend-only, same shape as /admin/bids and
 * /admin/projects itself: staff assignments and project_members are
 * org-scoped real data with no fixture-repository equivalent, so this
 * screen always requires a real authenticated admin/staff session
 * regardless of DEMO_MODE.
 */
export default async function ProjectTeamPage({ params }: { params: { id: string } }) {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const isAdmin = user.role === "admin";

  // includeArchived: true — an admin/staff viewer following a link to a
  // now-archived project's team should still land here; /admin/projects
  // itself already supports viewing archived projects (Decision 9), so
  // this detail page shouldn't be stricter than its own entry point.
  const accessible = await listAccessibleProjects(supabase, user.orgId, { includeArchived: true });
  const project = accessible.find((p) => p.id === params.id);

  if (!project) {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()}>
        <NoProjectAccess backHref="/admin/projects" />
      </AdminChrome>
    );
  }

  // Staff-assignment reads are admin-only at the RLS layer
  // (project_staff_assignments_admin_manage, schema/016, is `for all` —
  // SELECT included). Deliberately NOT queried at all for a non-admin
  // caller: RLS would return zero rows either way, but skipping the
  // query outright is the more honest signal — it lets
  // ProjectTeamWorkspace render a real "admin-only" restricted message
  // (driven by the `isAdmin` prop) instead of a misleadingly identical
  // "no staff assigned yet" empty-list state. Same reasoning applies to
  // the candidate-staff picker query below.
  const [staffAssignments, members, staffProfilesResult] = await Promise.all([
    isAdmin ? listProjectStaffAssignments(supabase, project.id) : Promise.resolve([] as ProjectStaffAssignmentRow[]),
    listProjectMembers(supabase, project.id),
    isAdmin
      ? supabase
          .from("profiles")
          .select("id, full_name, staff_function")
          .eq("org_id", user.orgId)
          .eq("role", "staff")
          .eq("is_active", true)
      : Promise.resolve({ data: [] as { id: string; full_name: string; staff_function: string | null }[] }),
  ]);

  const candidateStaff = (staffProfilesResult.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    staffFunction: p.staff_function as ProjectStaffAssignmentRow["staffFunction"],
  }));

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()}>
      <ProjectTeamWorkspace
        projectId={project.id}
        projectName={project.name}
        isAdmin={isAdmin}
        staffAssignments={staffAssignments}
        candidateStaff={candidateStaff}
        members={members}
        assignStaff={assignStaff}
        revokeAssignment={revokeAssignment}
        reactivateAssignment={reactivateAssignment}
        refreshAssignments={refreshAssignments}
      />
    </AdminChrome>
  );
}
