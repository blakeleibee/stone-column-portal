import { AdminChrome } from "../../../src/shell/AdminChrome";
import { VendorDirectoryWorkspace } from "../../../../../packages/02-app-shell/src/components/VendorDirectoryWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { isAccountingOrAdminStaff } from "../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listVendorDirectory } from "../../../../../packages/02-app-shell/src/services/vendorService";
import {
  createVendor,
  checkVendorDuplicate,
  getVendorDetail,
  updateVendorCoreFields,
  setVendorArchived,
  upsertVendorContact,
  archiveVendorContact,
  setVendorDocumentStatus,
  mergeVendors,
  unmergeVendor,
} from "./actions";

/**
 * /admin/vendors (Package P5.1) — org-level, no project context at all
 * (vendors are organization-scoped, matching Projects/Contacts/
 * Settings — see navigation.ts's "organization" section). Loads the
 * full vendor list ONCE here (status: "all" — the workspace itself does
 * search/trade/active-inactive filtering client-side, per
 * VendorDirectoryWorkspace.tsx's own header comment on why this screen
 * doesn't need a dedicated list-filtering Server Action).
 */
export default async function AdminVendorsPage() {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  const [vendors, canSeeW9] = await Promise.all([listVendorDirectory(supabase, user.orgId, { status: "all" }), isAccountingOrAdminStaff(supabase)]);

  return (
    <AdminChrome activeKey="vendors" isDemoMode={isDemoMode()}>
      <VendorDirectoryWorkspace
        orgId={user.orgId}
        vendors={vendors}
        isAccountingOrAdmin={canSeeW9}
        createVendor={createVendor}
        checkVendorDuplicate={checkVendorDuplicate}
        getVendorDetail={getVendorDetail}
        updateVendorCoreFields={updateVendorCoreFields}
        setVendorArchived={setVendorArchived}
        upsertVendorContact={upsertVendorContact}
        archiveVendorContact={archiveVendorContact}
        setVendorDocumentStatus={setVendorDocumentStatus}
        mergeVendors={mergeVendors}
        unmergeVendor={unmergeVendor}
      />
    </AdminChrome>
  );
}
