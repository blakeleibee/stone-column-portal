"use client";

/**
 * The `/admin/vendors` screen (Package P5.1) — a single Client
 * Component owning list + detail + every form, matching
 * BidPackageWorkspace.tsx's/MaterialOrderWorkspace.tsx's own
 * single-file-per-workflow shape (see BidPackageWorkspace.tsx's header
 * comment for the full rationale: every Server Action this component
 * calls is passed in as a prop from page.tsx, never imported directly,
 * so this package stays free of any apps/web/Next.js dependency).
 *
 * State-freshness rule (same lesson every other workspace in this
 * package already documents): after any mutation on the detail screen,
 * the WHOLE detail object is re-fetched via getVendorDetail() and
 * wholesale-replaces local state — never hand-patched. The list
 * (`vendors`) is the one exception: since there's no dedicated
 * `listVendorDirectory` Server Action wired here (the initial list is
 * server-loaded once by page.tsx and filtered/searched CLIENT-SIDE,
 * matching this screen's real-world data volume — a construction
 * company's vendor list is not a paginated-thousands-of-rows dataset),
 * a mutation that changes list-visible fields (name, active state)
 * patches the specific row in `vendors` from the same fresh detail
 * response, never from a client-guessed value.
 *
 * File upload/download deliberately do NOT go through a Server Action
 * — they call the dedicated Route Handlers
 * (/api/vendors/[vendorId]/documents[...]) directly via fetch()/a real
 * `<a href>`, per the brief's own routing design (vendor_documents isn't
 * project-scoped, so it doesn't reuse the existing project-scoped
 * documents route family).
 */
import React, { useMemo, useState } from "react";
import { Card, PageHeader, Button, TextInput, Textarea, Select, Checkbox, FormField, FormGrid, StatusBadge, Alert, EmptyState, Tabs } from "./ui";
import type { BadgeTone } from "./ui";
import { formatCents } from "../../../01-financial-engine/src/money";
import type {
  VendorDirectoryRow,
  VendorDetail,
  VendorContactRow,
  VendorDocumentRow,
  VendorDocumentCategory,
  VendorDocumentStatus,
  VendorDuplicateWarning,
  VendorCoreFieldUpdate,
  UpsertVendorContactInput,
  VendorHistoryEntry,
} from "../services/vendorService";

type ActionResult = { error?: string } | void | undefined;

const ONBOARDING_TONE: Record<string, BadgeTone> = { success: "sage", warning: "gold", error: "brick", neutral: "neutral" };

const DOCUMENT_CATEGORIES: { key: VendorDocumentCategory; label: string }[] = [
  { key: "w9", label: "W-9" },
  { key: "certificate_of_insurance", label: "Certificate of Insurance" },
  { key: "license", label: "License" },
  { key: "other", label: "Other" },
];

const DOCUMENT_STATUS_OPTIONS: { key: VendorDocumentStatus; label: string }[] = [
  { key: "missing", label: "Missing" },
  { key: "requested", label: "Requested" },
  { key: "received", label: "Received" },
  { key: "verified", label: "Verified" },
  { key: "expired", label: "Expired" },
  { key: "not_applicable", label: "Not applicable" },
];

const DOCUMENT_STATUS_TONE: Record<VendorDocumentStatus, BadgeTone> = {
  missing: "brick",
  requested: "gold",
  received: "sage",
  verified: "sage",
  expired: "brick",
  not_applicable: "neutral",
};

export interface VendorDirectoryWorkspaceProps {
  orgId: string;
  vendors: VendorDirectoryRow[];
  /** Gates the W-9 upload/status/download UI — mirrors
   *  is_accounting_or_admin_staff_for_org(), UI-only (RLS is the real
   *  enforcement). A viewer for whom this is false sees "restricted"
   *  text instead of a broken/absent control. */
  isAccountingOrAdmin: boolean;
  manageVendorsHref?: string; // self-link; unused today, reserved for symmetry with the other two screens' link target
  createVendor: (name: string, email?: string, phone?: string) => Promise<{ id?: string; error?: string }>;
  checkVendorDuplicate: (name: string, email?: string) => Promise<{ warning?: VendorDuplicateWarning }>;
  getVendorDetail: (vendorId: string) => Promise<{ detail?: VendorDetail; error?: string }>;
  updateVendorCoreFields: (vendorId: string, fields: VendorCoreFieldUpdate) => Promise<ActionResult>;
  setVendorArchived: (vendorId: string, archived: boolean) => Promise<ActionResult>;
  upsertVendorContact: (input: UpsertVendorContactInput) => Promise<{ id?: string; error?: string }>;
  archiveVendorContact: (contactId: string) => Promise<ActionResult>;
  setVendorDocumentStatus: (
    vendorId: string,
    category: VendorDocumentCategory,
    status: VendorDocumentStatus,
    expirationDate?: string | null
  ) => Promise<ActionResult>;
  mergeVendors: (loserVendorId: string, survivorVendorId: string) => Promise<ActionResult>;
  unmergeVendor: (vendorId: string) => Promise<ActionResult>;
}

export function VendorDirectoryWorkspace(props: VendorDirectoryWorkspaceProps) {
  const {
    vendors: initialVendors,
    isAccountingOrAdmin,
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
  } = props;

  const [vendors, setVendors] = useState<VendorDirectoryRow[]>(initialVendors);
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");

  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<VendorDuplicateWarning | null>(null);
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);

  const allTrades = useMemo(() => Array.from(new Set(vendors.flatMap((v) => v.trades))).sort(), [vendors]);

  const filteredVendors = useMemo(() => {
    return vendors.filter((v) => {
      if (statusFilter === "active" && !v.isActive) return false;
      if (statusFilter === "inactive" && v.isActive) return false;
      if (tradeFilter && !v.trades.includes(tradeFilter)) return false;
      if (search.trim()) {
        const term = search.trim().toLowerCase();
        const haystack = `${v.name} ${v.legalName ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [vendors, search, tradeFilter, statusFilter]);

  async function loadDetail(vendorId: string) {
    setSelectedVendorId(vendorId);
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab("overview");
    const result = await getVendorDetail(vendorId);
    setDetailLoading(false);
    if (result.error || !result.detail) {
      setDetailError(result.error ?? "Vendor not found.");
      setDetail(null);
      return;
    }
    setDetail(result.detail);
    setVendors((prev) => prev.map((v) => (v.id === vendorId ? { ...v, name: result.detail!.name, isActive: result.detail!.isActive } : v)));
  }

  async function handleNameOrEmailBlur() {
    if (!createName.trim() || duplicateDismissed) return;
    const result = await checkVendorDuplicate(createName, createEmail || undefined);
    setDuplicateWarning(result.warning ?? null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateSubmitting(true);
    setCreateError(null);
    const result = await createVendor(createName, createEmail || undefined, createPhone || undefined);
    setCreateSubmitting(false);
    if (result.error) {
      setCreateError(result.error);
      return;
    }
    setCreateName("");
    setCreateEmail("");
    setCreatePhone("");
    setDuplicateWarning(null);
    setDuplicateDismissed(false);
    // No listVendorDirectory Server Action is wired to this screen (see
    // header comment) — the newly created vendor is fetched directly by
    // id and spliced into local state, still sourced from a real
    // server round trip, never a client-guessed row.
    if (result.id) {
      const fresh = await getVendorDetail(result.id);
      if (fresh.detail) {
        setVendors((prev) => [
          {
            id: fresh.detail!.id,
            orgId: fresh.detail!.orgId,
            name: fresh.detail!.name,
            legalName: fresh.detail!.legalName,
            website: fresh.detail!.website,
            trades: fresh.detail!.trades,
            serviceArea: fresh.detail!.serviceArea,
            preferredCommunicationMethod: fresh.detail!.preferredCommunicationMethod,
            paymentTerms: fresh.detail!.paymentTerms,
            contactName: fresh.detail!.contactName,
            email: fresh.detail!.email,
            phone: fresh.detail!.phone,
            address: fresh.detail!.address,
            notes: fresh.detail!.notes,
            isActive: fresh.detail!.isActive,
            mergedIntoVendorId: fresh.detail!.mergedIntoVendorId,
            createdAt: fresh.detail!.createdAt,
          },
          ...prev,
        ]);
      }
    }
  }

  return (
    <div className="sc-vendors-workspace">
      <PageHeader title="Vendor Directory" subtitle="Every vendor Stone Column has worked with — contacts, compliance documents, and history." />

      <div className="sc-vendors-layout">
        <div className="sc-vendors-list-col">
          <Card>
            <div className="sc-vendors-form">
              <FormField label="Search" htmlFor="sc-vendors-search">
                <TextInput id="sc-vendors-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or legal name" />
              </FormField>
              <FormField label="Trade" htmlFor="sc-vendors-trade">
                <Select id="sc-vendors-trade" value={tradeFilter} onChange={(e) => setTradeFilter(e.target.value)}>
                  <option value="">All trades</option>
                  {allTrades.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Status" htmlFor="sc-vendors-status">
                <Select id="sc-vendors-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="all">All</option>
                </Select>
              </FormField>
            </div>
          </Card>

          {filteredVendors.length === 0 ? (
            <EmptyState title="No vendors match these filters" />
          ) : (
            <ul className="sc-vendors-list">
              {filteredVendors.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={["sc-vendors-list-item", selectedVendorId === v.id ? "sc-vendors-list-item-active" : ""].join(" ")}
                    onClick={() => loadDetail(v.id)}
                  >
                    <span className="sc-vendors-list-name">{v.name}</span>
                    <span className="sc-vendors-list-meta">
                      {!v.isActive && <StatusBadge label={v.mergedIntoVendorId ? "Merged" : "Inactive"} tone="neutral" />}
                      {v.trades.slice(0, 2).join(", ")}
                    </span>
                    <VendorOnboardingBadge vendor={v} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Card>
            <h4>Add a vendor</h4>
            <form onSubmit={handleCreate} className="sc-vendors-form">
              <FormField label="Name" htmlFor="sc-vendors-create-name" required>
                <TextInput
                  id="sc-vendors-create-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onBlur={handleNameOrEmailBlur}
                  required
                />
              </FormField>
              <FormField label="Email (optional)" htmlFor="sc-vendors-create-email">
                <TextInput
                  id="sc-vendors-create-email"
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  onBlur={handleNameOrEmailBlur}
                />
              </FormField>
              <FormField label="Phone (optional)" htmlFor="sc-vendors-create-phone">
                <TextInput id="sc-vendors-create-phone" value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} />
              </FormField>

              {duplicateWarning && !duplicateDismissed && (
                <Alert tone="warning" title="Possible duplicate vendor">
                  This looks similar to the existing vendor "{duplicateWarning.matchedVendorName}" (matched on {duplicateWarning.matchType}).{" "}
                  <button type="button" className="sc-vendors-link-btn" onClick={() => setDuplicateDismissed(true)}>
                    Dismiss and create anyway
                  </button>
                </Alert>
              )}

              <Button type="submit" variant="primary" disabled={createSubmitting} loading={createSubmitting} loadingText="Creating…">
                Create Vendor
              </Button>
              {createError && <Alert tone="error">{createError}</Alert>}
            </form>
          </Card>
        </div>

        <div className="sc-vendors-detail-col">
          {!selectedVendorId && <EmptyState title="Select a vendor" description="Choose a vendor from the list to view or edit its details." />}
          {detailLoading && <p className="sc-vendors-muted">Loading…</p>}
          {detailError && <Alert tone="error">{detailError}</Alert>}
          {detail && !detailLoading && (
            <VendorDetailPanel
              detail={detail}
              isAccountingOrAdmin={isAccountingOrAdmin}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              allVendors={vendors}
              onReload={() => loadDetail(detail.id)}
              updateVendorCoreFields={updateVendorCoreFields}
              setVendorArchived={setVendorArchived}
              upsertVendorContact={upsertVendorContact}
              archiveVendorContact={archiveVendorContact}
              setVendorDocumentStatus={setVendorDocumentStatus}
              mergeVendors={mergeVendors}
              unmergeVendor={unmergeVendor}
            />
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

function VendorOnboardingBadge({ vendor }: { vendor: VendorDirectoryRow }) {
  // The list only has vendors' core fields, not their documents (no
  // batched per-vendor document fetch is wired into the initial list
  // load — see page.tsx) — this renders nothing on the list row itself;
  // the real, document-backed badge (summarizeVendorOnboardingStatus)
  // renders on the Overview tab of the detail panel instead, per the
  // brief's "computed by reading that vendor's vendor_documents rows"
  // instruction. Kept as a named component (rather than inlined) so a
  // future batched-summary list fetch has an obvious single place to
  // wire real data into.
  void vendor;
  return null;
}

// -----------------------------------------------------------------------
// Detail panel
// -----------------------------------------------------------------------

function VendorDetailPanel(props: {
  detail: VendorDetail;
  isAccountingOrAdmin: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  allVendors: VendorDirectoryRow[];
  onReload: () => void;
  updateVendorCoreFields: VendorDirectoryWorkspaceProps["updateVendorCoreFields"];
  setVendorArchived: VendorDirectoryWorkspaceProps["setVendorArchived"];
  upsertVendorContact: VendorDirectoryWorkspaceProps["upsertVendorContact"];
  archiveVendorContact: VendorDirectoryWorkspaceProps["archiveVendorContact"];
  setVendorDocumentStatus: VendorDirectoryWorkspaceProps["setVendorDocumentStatus"];
  mergeVendors: VendorDirectoryWorkspaceProps["mergeVendors"];
  unmergeVendor: VendorDirectoryWorkspaceProps["unmergeVendor"];
}) {
  const { detail, activeTab, setActiveTab, allVendors, onReload } = props;

  const tabs = [
    { key: "overview", label: "Overview", onClick: () => setActiveTab("overview") },
    { key: "contacts", label: "Contacts", onClick: () => setActiveTab("contacts") },
    { key: "compliance", label: "Compliance & Licensing", onClick: () => setActiveTab("compliance") },
    { key: "payment", label: "Payment Terms", onClick: () => setActiveTab("payment") },
    { key: "notes", label: "Internal Notes", onClick: () => setActiveTab("notes") },
    { key: "history", label: "History", onClick: () => setActiveTab("history") },
  ];

  return (
    <Card>
      <div className="sc-vendors-detail-header">
        <h3>{detail.name}</h3>
        <VendorStatusBadges detail={detail} />
      </div>

      {detail.mergedIntoVendorId && (
        <Alert tone="info">
          Merged into <a href={`?vendor=${detail.mergedIntoVendorId}`}>{detail.mergedIntoVendorName ?? "another vendor"}</a>.
        </Alert>
      )}

      <Tabs items={tabs} activeKey={activeTab} aria-label="Vendor detail sections" />

      <div className="sc-vendors-tab-panel">
        {activeTab === "overview" && <OverviewTab {...props} />}
        {activeTab === "contacts" && <ContactsTab {...props} />}
        {activeTab === "compliance" && <ComplianceTab {...props} />}
        {activeTab === "payment" && <PaymentTermsTab {...props} />}
        {activeTab === "notes" && <NotesTab {...props} />}
        {activeTab === "history" && <HistoryTab history={detail.history} />}
      </div>

      {/* Merge is a general staff action, not accounting-only. */}
      <MergeSection detail={detail} allVendors={allVendors} onReload={onReload} mergeVendors={props.mergeVendors} unmergeVendor={props.unmergeVendor} />
    </Card>
  );
}

function VendorStatusBadges({ detail }: { detail: VendorDetail }) {
  const onboarding = detail.onboardingStatus;
  return (
    <div className="sc-vendors-badges">
      <StatusBadge label={detail.isActive ? "Active" : "Inactive"} tone={detail.isActive ? "sage" : "neutral"} />
      <StatusBadge label={onboarding.label} tone={ONBOARDING_TONE[onboarding.tone]} />
    </div>
  );
}

function OverviewTab({
  detail,
  onReload,
  updateVendorCoreFields,
  setVendorArchived,
}: {
  detail: VendorDetail;
  onReload: () => void;
  updateVendorCoreFields: VendorDirectoryWorkspaceProps["updateVendorCoreFields"];
  setVendorArchived: VendorDirectoryWorkspaceProps["setVendorArchived"];
}) {
  const [legalName, setLegalName] = useState(detail.legalName ?? "");
  const [website, setWebsite] = useState(detail.website ?? "");
  const [tradesText, setTradesText] = useState(detail.trades.join(", "));
  const [serviceArea, setServiceArea] = useState(detail.serviceArea ?? "");
  const [preferredCommunicationMethod, setPreferredCommunicationMethod] = useState(detail.preferredCommunicationMethod ?? "");
  const [address, setAddress] = useState(detail.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveConfirming, setArchiveConfirming] = useState(false);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateVendorCoreFields(detail.id, {
      legalName,
      website,
      trades: tradesText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      serviceArea,
      preferredCommunicationMethod,
      address,
    });
    setSaving(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  async function handleToggleArchive() {
    setArchiveSubmitting(true);
    const result = await setVendorArchived(detail.id, detail.isActive);
    setArchiveSubmitting(false);
    setArchiveConfirming(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  return (
    <div>
      <form onSubmit={handleSave} className="sc-vendors-form">
        <FormGrid columns={2}>
          <FormField label="Legal name" htmlFor="sc-vendors-legalname">
            <TextInput id="sc-vendors-legalname" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </FormField>
          <FormField label="Website" htmlFor="sc-vendors-website">
            <TextInput id="sc-vendors-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </FormField>
          <FormField label="Trades (comma-separated)" htmlFor="sc-vendors-trades">
            <TextInput id="sc-vendors-trades" value={tradesText} onChange={(e) => setTradesText(e.target.value)} />
          </FormField>
          <FormField label="Service area" htmlFor="sc-vendors-servicearea">
            <TextInput id="sc-vendors-servicearea" value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} />
          </FormField>
          <FormField label="Preferred communication method" htmlFor="sc-vendors-comm">
            <TextInput id="sc-vendors-comm" value={preferredCommunicationMethod} onChange={(e) => setPreferredCommunicationMethod(e.target.value)} />
          </FormField>
          <FormField label="Address" htmlFor="sc-vendors-address">
            <TextInput id="sc-vendors-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </FormField>
        </FormGrid>
        <Button type="submit" variant="secondary" disabled={saving} loading={saving} loadingText="Saving…">
          Save
        </Button>
        {error && <Alert tone="error">{error}</Alert>}
      </form>

      <section className="sc-vendors-section">
        <h4>Status</h4>
        {archiveConfirming ? (
          <div className="sc-vendors-confirm">
            <Alert tone="warning" title={detail.isActive ? "Mark this vendor inactive?" : "Reactivate this vendor?"}>
              {detail.isActive
                ? "It will no longer appear in Bids/Material Orders vendor selectors for new work."
                : "It will become selectable again in Bids/Material Orders."}
            </Alert>
            <div className="sc-vendors-confirm-actions">
              <Button variant="primary" size="sm" disabled={archiveSubmitting} loading={archiveSubmitting} onClick={handleToggleArchive}>
                Yes, {detail.isActive ? "mark inactive" : "reactivate"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setArchiveConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setArchiveConfirming(true)} disabled={!!detail.mergedIntoVendorId}>
            {detail.isActive ? "Mark inactive" : "Reactivate"}
          </Button>
        )}
        {detail.mergedIntoVendorId && <p className="sc-vendors-muted">Use Unmerge below to restore this vendor instead.</p>}
      </section>
    </div>
  );
}

function ContactsTab({
  detail,
  onReload,
  upsertVendorContact,
  archiveVendorContact,
}: {
  detail: VendorDetail;
  onReload: () => void;
  upsertVendorContact: VendorDirectoryWorkspaceProps["upsertVendorContact"];
  archiveVendorContact: VendorDirectoryWorkspaceProps["archiveVendorContact"];
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Record<string, boolean>>({});

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await upsertVendorContact({ vendorId: detail.id, name, title, email, phone, isPrimaryBiddingContact: isPrimary });
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setName("");
    setTitle("");
    setEmail("");
    setPhone("");
    setIsPrimary(false);
    onReload();
  }

  async function handleArchive(contactId: string) {
    setArchiving((prev) => ({ ...prev, [contactId]: true }));
    await archiveVendorContact(contactId);
    setArchiving((prev) => ({ ...prev, [contactId]: false }));
    onReload();
  }

  const activeContacts = detail.contacts.filter((c) => !c.isArchived);

  return (
    <div>
      {activeContacts.length === 0 ? (
        <EmptyState title="No contacts yet" />
      ) : (
        <ul className="sc-vendors-contact-list">
          {activeContacts.map((c: VendorContactRow) => (
            <li key={c.id} className="sc-vendors-contact-item">
              <div>
                <strong>{c.name}</strong> {c.isPrimaryBiddingContact && <StatusBadge label="Primary bidding contact" tone="sage" />}
                {c.title && <div className="sc-vendors-muted">{c.title}</div>}
                {c.email && <div className="sc-vendors-muted">{c.email}</div>}
                {c.phone && <div className="sc-vendors-muted">{c.phone}</div>}
              </div>
              <Button variant="secondary" size="sm" disabled={!!archiving[c.id]} loading={!!archiving[c.id]} onClick={() => handleArchive(c.id)}>
                Archive
              </Button>
            </li>
          ))}
        </ul>
      )}

      <section className="sc-vendors-section">
        <h4>Add a contact</h4>
        <form onSubmit={handleAdd} className="sc-vendors-form">
          <FormGrid columns={2}>
            <FormField label="Name" htmlFor="sc-vendors-contact-name" required>
              <TextInput id="sc-vendors-contact-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </FormField>
            <FormField label="Title" htmlFor="sc-vendors-contact-title">
              <TextInput id="sc-vendors-contact-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </FormField>
            <FormField label="Email" htmlFor="sc-vendors-contact-email">
              <TextInput id="sc-vendors-contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Phone" htmlFor="sc-vendors-contact-phone">
              <TextInput id="sc-vendors-contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
          </FormGrid>
          <Checkbox label="Primary bidding contact" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          <Button type="submit" variant="primary" disabled={submitting} loading={submitting} loadingText="Adding…">
            Add contact
          </Button>
          {error && <Alert tone="error">{error}</Alert>}
        </form>
      </section>
    </div>
  );
}

function ComplianceTab({
  detail,
  isAccountingOrAdmin,
  onReload,
  setVendorDocumentStatus,
}: {
  detail: VendorDetail;
  isAccountingOrAdmin: boolean;
  onReload: () => void;
  setVendorDocumentStatus: VendorDirectoryWorkspaceProps["setVendorDocumentStatus"];
}) {
  return (
    <div>
      {DOCUMENT_CATEGORIES.map((cat) => (
        <DocumentCategoryCard
          key={cat.key}
          vendorId={detail.id}
          categoryKey={cat.key}
          categoryLabel={cat.label}
          document={detail.documents.find((d) => d.category === cat.key && !d.supersededById) ?? null}
          isAccountingOrAdmin={isAccountingOrAdmin}
          onReload={onReload}
          setVendorDocumentStatus={setVendorDocumentStatus}
        />
      ))}
    </div>
  );
}

function DocumentCategoryCard({
  vendorId,
  categoryKey,
  categoryLabel,
  document,
  isAccountingOrAdmin,
  onReload,
  setVendorDocumentStatus,
}: {
  vendorId: string;
  categoryKey: VendorDocumentCategory;
  categoryLabel: string;
  document: VendorDocumentRow | null;
  isAccountingOrAdmin: boolean;
  onReload: () => void;
  setVendorDocumentStatus: VendorDirectoryWorkspaceProps["setVendorDocumentStatus"];
}) {
  const restricted = categoryKey === "w9" && !isAccountingOrAdmin;
  const [status, setStatus] = useState<VendorDocumentStatus>(document?.status ?? "missing");
  const [expirationDate, setExpirationDate] = useState(document?.expirationDate ?? "");
  const [statusSaving, setStatusSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStatusSave() {
    setStatusSaving(true);
    setError(null);
    const result = await setVendorDocumentStatus(vendorId, categoryKey, status, expirationDate || null);
    setStatusSaving(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", categoryKey);
      if (expirationDate) formData.append("expirationDate", expirationDate);
      const response = await fetch(`/api/vendors/${vendorId}/documents`, { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Upload failed.");
        return;
      }
      onReload();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <Card className="sc-vendors-doc-card">
      <div className="sc-vendors-doc-header">
        <h4>{categoryLabel}</h4>
        <StatusBadge label={DOCUMENT_STATUS_OPTIONS.find((o) => o.key === (document?.status ?? "missing"))?.label ?? "Missing"} tone={DOCUMENT_STATUS_TONE[document?.status ?? "missing"]} />
      </div>

      {restricted ? (
        <Alert tone="info">Restricted — accounting/admin only.</Alert>
      ) : (
        <>
          <FormGrid columns={2}>
            <FormField label="Status" htmlFor={`sc-vendors-doc-status-${categoryKey}`}>
              <Select id={`sc-vendors-doc-status-${categoryKey}`} value={status} onChange={(e) => setStatus(e.target.value as VendorDocumentStatus)}>
                {DOCUMENT_STATUS_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Expiration date" htmlFor={`sc-vendors-doc-expiry-${categoryKey}`}>
              <TextInput
                id={`sc-vendors-doc-expiry-${categoryKey}`}
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
              />
            </FormField>
          </FormGrid>
          <div className="sc-vendors-inline-form">
            <Button variant="secondary" size="sm" disabled={statusSaving} loading={statusSaving} onClick={handleStatusSave}>
              Save status
            </Button>
            <label className="sc-ui-btn sc-ui-btn-secondary sc-ui-btn-sm sc-vendors-upload-btn">
              {uploading ? "Uploading…" : document ? `Upload new version (v${document.version + 1})` : "Upload file"}
              <input type="file" onChange={handleUpload} disabled={uploading} hidden />
            </label>
            {categoryKey === "w9" && document?.storageKey && (
              <a
                href={`/api/vendors/${vendorId}/documents/${document.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="sc-ui-btn sc-ui-btn-secondary sc-ui-btn-sm"
              >
                Download (logged, expires in 5 min)
              </a>
            )}
            {categoryKey !== "w9" && document?.storageKey && (
              <a
                href={`/api/vendors/${vendorId}/documents/${document.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="sc-ui-btn sc-ui-btn-secondary sc-ui-btn-sm"
              >
                Download
              </a>
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </>
      )}
    </Card>
  );
}

function PaymentTermsTab({
  detail,
  onReload,
  updateVendorCoreFields,
}: {
  detail: VendorDetail;
  onReload: () => void;
  updateVendorCoreFields: VendorDirectoryWorkspaceProps["updateVendorCoreFields"];
}) {
  const [paymentTerms, setPaymentTerms] = useState(detail.paymentTerms ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateVendorCoreFields(detail.id, { paymentTerms });
    setSaving(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  return (
    <form onSubmit={handleSave} className="sc-vendors-form">
      <FormField label="Payment terms" htmlFor="sc-vendors-payment-terms" hint='Plain text, e.g. "Net 30".'>
        <Textarea id="sc-vendors-payment-terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} rows={3} />
      </FormField>
      <Button type="submit" variant="secondary" disabled={saving} loading={saving} loadingText="Saving…">
        Save
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

function NotesTab({
  detail,
  onReload,
  updateVendorCoreFields,
}: {
  detail: VendorDetail;
  onReload: () => void;
  updateVendorCoreFields: VendorDirectoryWorkspaceProps["updateVendorCoreFields"];
}) {
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateVendorCoreFields(detail.id, { notes });
    setSaving(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  return (
    <form onSubmit={handleSave} className="sc-vendors-form">
      <FormField label="Internal notes" htmlFor="sc-vendors-notes" hint="Never shown to any vendor or client.">
        <Textarea id="sc-vendors-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
      </FormField>
      <Button type="submit" variant="secondary" disabled={saving} loading={saving} loadingText="Saving…">
        Save
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

function HistoryTab({ history }: { history: VendorHistoryEntry[] }) {
  if (history.length === 0) return <EmptyState title="No history yet" description="Bids, orders, commitments, and issued documents involving this vendor will appear here." />;
  return (
    <div className="sc-vendors-table-scroll">
      <table className="sc-vendors-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Date</th>
            <th style={{ textAlign: "left" }}>Type</th>
            <th style={{ textAlign: "left" }}>Description</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th style={{ textAlign: "left" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={`${entry.sourceType}-${entry.id}`}>
              <td>{new Date(entry.occurredAt).toLocaleDateString()}</td>
              <td>{entry.sourceType.replace(/_/g, " ")}</td>
              <td>{entry.label}</td>
              <td style={{ textAlign: "right" }}>{entry.amountCents != null ? formatCents(entry.amountCents) : "—"}</td>
              <td>{entry.status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MergeSection({
  detail,
  allVendors,
  onReload,
  mergeVendors,
  unmergeVendor,
}: {
  detail: VendorDetail;
  allVendors: VendorDirectoryRow[];
  onReload: () => void;
  mergeVendors: VendorDirectoryWorkspaceProps["mergeVendors"];
  unmergeVendor: VendorDirectoryWorkspaceProps["unmergeVendor"];
}) {
  const [survivorId, setSurvivorId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = allVendors.filter((v) => v.id !== detail.id && !v.mergedIntoVendorId);
  const survivorName = candidates.find((v) => v.id === survivorId)?.name;

  async function handleMergeConfirm() {
    setSubmitting(true);
    setError(null);
    const result = await mergeVendors(detail.id, survivorId);
    setSubmitting(false);
    setConfirming(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  async function handleUnmerge() {
    setSubmitting(true);
    setError(null);
    const result = await unmergeVendor(detail.id);
    setSubmitting(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    onReload();
  }

  return (
    <section className="sc-vendors-section">
      <h4>Duplicate vendor?</h4>
      {detail.mergedIntoVendorId ? (
        <div className="sc-vendors-confirm">
          <p className="sc-vendors-muted">
            This vendor is merged into <strong>{detail.mergedIntoVendorName}</strong>. Its own history (bids, orders, commitments) stays attributed
            to it — nothing was rewritten.
          </p>
          <Button variant="secondary" size="sm" disabled={submitting} loading={submitting} onClick={handleUnmerge}>
            Unmerge
          </Button>
        </div>
      ) : confirming ? (
        <div className="sc-vendors-confirm">
          <Alert tone="warning" title={`Merge "${detail.name}" into "${survivorName}"?`}>
            "{detail.name}" will be archived and marked merged into "{survivorName}". Its existing bid/order history stays exactly as it is — the
            survivor's History tab will show both vendors' activity together.
          </Alert>
          <div className="sc-vendors-confirm-actions">
            <Button variant="primary" size="sm" disabled={submitting} loading={submitting} onClick={handleMergeConfirm}>
              Yes, merge
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="sc-vendors-inline-form">
          <Select value={survivorId} onChange={(e) => setSurvivorId(e.target.value)} aria-label="Merge into">
            <option value="">— select the surviving vendor —</option>
            {candidates.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" disabled={!survivorId} onClick={() => setConfirming(true)}>
            Merge into…
          </Button>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </section>
  );
}

const workspaceStyles = `
.sc-vendors-layout { display: flex; gap: 24px; align-items: flex-start; }
.sc-vendors-list-col { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; gap: 16px; }
.sc-vendors-detail-col { flex: 1; min-width: 0; }
.sc-vendors-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.sc-vendors-list-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; }
.sc-vendors-list-item-active { border-color: #6b8f71; background: #f0f5f1; }
.sc-vendors-list-name { font-weight: 600; }
.sc-vendors-list-meta { font-size: 12px; color: #666; display: flex; gap: 6px; align-items: center; }
.sc-vendors-form { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; width: 100%; }
.sc-vendors-detail-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-vendors-badges { display: flex; gap: 6px; }
.sc-vendors-tab-panel { margin-top: 16px; }
.sc-vendors-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e5e5; }
.sc-vendors-muted { color: #666; font-size: 13px; }
.sc-vendors-confirm { display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
.sc-vendors-confirm-actions { display: flex; gap: 8px; align-items: center; }
.sc-vendors-inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.sc-vendors-contact-list { list-style: none; padding: 0; margin: 0 0 16px 0; display: flex; flex-direction: column; gap: 8px; }
.sc-vendors-contact-item { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; }
.sc-vendors-doc-card { margin-top: 12px; }
.sc-vendors-doc-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sc-vendors-upload-btn { cursor: pointer; }
.sc-vendors-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sc-vendors-table th { padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-vendors-table td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
.sc-vendors-table-scroll { overflow-x: auto; }
.sc-vendors-link-btn { background: none; border: none; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }

@media (max-width: 767px) {
  .sc-vendors-layout { flex-direction: column; align-items: stretch; }
  .sc-vendors-list-col { width: 100%; }
}
`;
