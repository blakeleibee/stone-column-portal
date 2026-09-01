import { AdminChrome } from "../../../src/shell/AdminChrome";
import { MaterialOrderWorkspace } from "../../../../../packages/02-app-shell/src/components/MaterialOrderWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listMaterialOrders } from "../../../../../packages/02-app-shell/src/services/procurementService";
import { listVendors } from "../../../../../packages/02-app-shell/src/services/bidService";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";
import {
  createMaterialOrder,
  addMaterialOrderLineItem,
  commitMaterialOrder,
  recordReceivedQuantity,
  issuePurchaseOrder,
  getMaterialOrderDetail,
  getCommittedCostsForProject,
  getLatestIssuedPurchaseOrder,
} from "./actions";

/**
 * Resolves its project/switcher data via resolveProjectAndSwitcherData(),
 * the exact same shape /admin/bids/page.tsx uses (P5 Task 6) — see this
 * task's own correction to the plan's older "same shape as /admin/bids"
 * wording, verified directly against that file rather than an older
 * plan draft. Like /admin/bids (and unlike /admin/commitments/estimate),
 * there is no demo-mode/fixture fallback here: material_orders/
 * material_order_line_items are staff/admin-only real-backend
 * procurement data with no fixture repository equivalent, so this screen
 * always requires a real authenticated admin/staff session, regardless
 * of DEMO_MODE.
 */
export default async function AdminProcurementPage() {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { project, switcherData } = await resolveProjectAndSwitcherData(supabase, user.orgId, user.role);

  if (!project) {
    return (
      <AdminChrome activeKey="procurement" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const [materialOrders, costCodes, vendors] = await Promise.all([
    listMaterialOrders(supabase, project.id),
    repo.getCostCodes(project.id),
    listVendors(supabase, user.orgId),
  ]);

  return (
    <AdminChrome activeKey="procurement" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <MaterialOrderWorkspace
        projectId={project.id}
        materialOrders={materialOrders}
        costCodes={costCodes}
        vendors={vendors}
        createMaterialOrder={createMaterialOrder}
        getMaterialOrderDetail={getMaterialOrderDetail}
        addMaterialOrderLineItem={addMaterialOrderLineItem}
        commitMaterialOrder={commitMaterialOrder}
        recordReceivedQuantity={recordReceivedQuantity}
        issuePurchaseOrder={issuePurchaseOrder}
        getCommittedCostsForProject={getCommittedCostsForProject}
        getLatestIssuedPurchaseOrder={getLatestIssuedPurchaseOrder}
      />
    </AdminChrome>
  );
}
