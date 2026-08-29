import { AdminChrome } from "../../../src/shell/AdminChrome";
import { BidPackageWorkspace } from "../../../../../packages/02-app-shell/src/components/BidPackageWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listBidPackages, listVendors } from "../../../../../packages/02-app-shell/src/services/bidService";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";
import { createBidPackage, publishBidPackage, inviteVendor, getBidPackageDetail, listBidQuestions, listBidAddenda } from "./actions";
import { recordBidSubmission, awardBid, askBidQuestion, answerBidQuestion, issueBidAddendum } from "./submissionActions";

/**
 * Resolves its project/switcher data via resolveSelectedProject()
 * (through the shared resolveProjectAndSwitcherData() helper), same as
 * /admin/estimate/page.tsx and /admin/import/page.tsx — Task 5 replaced
 * every page's earlier ad hoc "first project" query with this. Like
 * /admin/import (and unlike /admin/estimate), there is no demo-mode/
 * fixture fallback here: bids are staff/admin-only real-backend
 * procurement data with no fixture repository equivalent
 * (bid_packages/bid_submissions/bid_questions/bid_addenda), so this
 * screen always requires a real authenticated admin/staff session,
 * regardless of DEMO_MODE.
 */
export default async function AdminBidsPage() {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { project, switcherData } = await resolveProjectAndSwitcherData(supabase, user.orgId, user.role);

  if (!project) {
    return (
      <AdminChrome activeKey="bids" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const [bidPackages, costCodes, vendors] = await Promise.all([
    listBidPackages(supabase, project.id),
    repo.getCostCodes(project.id),
    listVendors(supabase, user.orgId),
  ]);

  return (
    <AdminChrome activeKey="bids" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <BidPackageWorkspace
        projectId={project.id}
        bidPackages={bidPackages}
        costCodes={costCodes}
        vendors={vendors}
        createBidPackage={createBidPackage}
        publishBidPackage={publishBidPackage}
        inviteVendor={inviteVendor}
        getBidPackageDetail={getBidPackageDetail}
        listBidQuestions={listBidQuestions}
        listBidAddenda={listBidAddenda}
        recordBidSubmission={recordBidSubmission}
        awardBid={awardBid}
        askBidQuestion={askBidQuestion}
        answerBidQuestion={answerBidQuestion}
        issueBidAddendum={issueBidAddendum}
      />
    </AdminChrome>
  );
}
