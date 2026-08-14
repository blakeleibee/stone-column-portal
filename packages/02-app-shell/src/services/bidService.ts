import type { SupabaseClient } from "@supabase/supabase-js";

export interface BidPackageRow {
  id: string;
  projectId: string;
  costCodeId: string;
  title: string;
  scopeDescription: string | null;
  dueAt: string | null;
  status: "draft" | "published" | "awarded" | "cancelled";
  createdAt: string;
}

function mapBidPackage(row: any): BidPackageRow {
  return {
    id: row.id,
    projectId: row.project_id,
    costCodeId: row.cost_code_id,
    title: row.title,
    scopeDescription: row.scope_description,
    dueAt: row.due_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listBidPackages(supabase: SupabaseClient, projectId: string): Promise<BidPackageRow[]> {
  const { data, error } = await supabase.from("bid_packages").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBidPackage);
}

export async function createBidPackage(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  title: string,
  scopeDescription?: string,
  dueAt?: string
) {
  if (!title.trim()) return { error: "Title is required." };
  const { data, error } = await supabase
    .from("bid_packages")
    .insert({ project_id: projectId, cost_code_id: costCodeId, title: title.trim(), scope_description: scopeDescription ?? null, due_at: dueAt ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export async function publishBidPackage(supabase: SupabaseClient, bidPackageId: string) {
  const { error } = await supabase.from("bid_packages").update({ status: "published" }).eq("id", bidPackageId).eq("status", "draft");
  if (error) return { error: error.message };
  return {};
}

export interface BidSubmissionRow {
  id: string;
  bidPackageId: string;
  vendorId: string;
  vendorName: string;
  status: "invited" | "submitted" | "awarded" | "declined" | "withdrawn";
  amountCents: number | null;
  notes: string | null;
  submittedAt: string | null;
}

export interface BidPackageDetail extends BidPackageRow {
  submissions: BidSubmissionRow[];
}

export async function inviteVendor(supabase: SupabaseClient, bidPackageId: string, vendorId: string) {
  const { error } = await supabase.from("bid_submissions").insert({ bid_package_id: bidPackageId, vendor_id: vendorId });
  if (error) return { error: error.message };
  return {};
}

export async function getBidPackageDetail(supabase: SupabaseClient, bidPackageId: string): Promise<BidPackageDetail | null> {
  const { data: pkgRow, error: pkgError } = await supabase.from("bid_packages").select("*").eq("id", bidPackageId).maybeSingle();
  if (pkgError) throw pkgError;
  if (!pkgRow) return null;

  const { data: subRows, error: subError } = await supabase
    .from("bid_submissions")
    .select("id, bid_package_id, vendor_id, status, amount_cents, notes, submitted_at, vendors(name)")
    .eq("bid_package_id", bidPackageId);
  if (subError) throw subError;

  return {
    ...mapBidPackage(pkgRow),
    submissions: (subRows ?? []).map((row: any) => ({
      id: row.id,
      bidPackageId: row.bid_package_id,
      vendorId: row.vendor_id,
      vendorName: row.vendors?.name ?? "Unknown vendor",
      status: row.status,
      amountCents: row.amount_cents,
      notes: row.notes,
      submittedAt: row.submitted_at,
    })),
  };
}

export interface VendorRow {
  id: string;
  name: string;
}

export async function listVendors(supabase: SupabaseClient, orgId: string): Promise<VendorRow[]> {
  const { data, error } = await supabase.from("vendors").select("id, name").eq("org_id", orgId).eq("is_archived", false).order("name");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, name: row.name }));
}

/** revoked_by is deliberately NOT a parameter — the DB trigger
 *  (enforce_vendor_member_identity_and_revocation) requires it to equal
 *  the acting session's own auth.uid() and rejects anything else, so
 *  passing it here would only ever fail; the plain update relies on the
 *  RLS-scoped client's own session to supply the correct value via the
 *  trigger, exactly like recorded_by's DB-boundary enforcement above. */
export async function revokeVendorMember(supabase: SupabaseClient, vendorId: string, profileId: string) {
  const { error } = await supabase
    .from("vendor_members")
    .update({ revoked_at: new Date().toISOString(), revoked_by: (await supabase.auth.getUser()).data.user?.id })
    .eq("vendor_id", vendorId)
    .eq("profile_id", profileId);
  if (error) return { error: error.message };
  return {};
}

export async function reactivateVendorMember(supabase: SupabaseClient, vendorId: string, profileId: string) {
  const { error } = await supabase
    .from("vendor_members")
    .update({ revoked_at: null })
    .eq("vendor_id", vendorId)
    .eq("profile_id", profileId);
  if (error) return { error: error.message };
  return {};
}
