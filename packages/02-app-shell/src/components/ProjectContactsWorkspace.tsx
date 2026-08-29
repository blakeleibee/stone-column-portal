"use client";

/**
 * `/admin/projects/[id]/contacts` (P3.1, Task 6) — the project-scoped
 * screen for managing `project_clients` (design §4: homeowners,
 * decision-makers, other household, and professional contacts like an
 * architect/engineer, all through this ONE surface — see
 * P3.1-DESIGN.md §6's explicit ruling that `project_site_info` gets no
 * contact fields of its own).
 *
 * Two exported pieces, per the Task 6 brief's explicit instruction ("one
 * form, two entry points" — design §4/§11):
 *
 *   - `ProjectContactForm` — the add/edit FORM alone. Takes no
 *     `projectId` and never calls a Server Action itself; it only
 *     validates and hands a fully-formed `ProjectContactInput` to its
 *     `onSubmit` prop. This is deliberate, not an oversight — see the
 *     "create-time contact collection" note below.
 *   - `ProjectContactsWorkspace` — the full list + management view,
 *     used on the Setup screen's "Homeowners & decision-makers"
 *     section. Renders `ProjectContactForm` inside itself for both
 *     add and edit, wiring its `onSubmit` to the real
 *     `upsertProjectContact` Server Action for a real, already-created
 *     project.
 *
 * CREATE-TIME CONTACT COLLECTION (the FK sequencing question the Task 6
 * brief flagged as a real design decision, not a guess to make
 * silently):
 *
 * `project_clients.project_id` is `not null references projects(id)`
 * (schema/012) — a `project_clients` row can only be inserted once a
 * real `projects` row exists. The create-project panel (Task 4)
 * necessarily runs BEFORE that row exists. So Task 4's "quick add
 * primary homeowner" flow cannot call `upsertProjectContact()` (via the
 * `upsertContact` Server Action, which requires a real `projectId`)
 * while the create form is still open.
 *
 * The chosen design (option (a) from the brief, the only one consistent
 * with the FK): Task 4 renders `ProjectContactForm` directly — NOT
 * `ProjectContactsWorkspace` (there's no list to show; nothing exists
 * yet) — with `onSubmit` wired to a LOCAL state setter, not a Server
 * Action. `ProjectContactForm` doesn't know or care that its `onSubmit`
 * isn't hitting the database yet; it just calls the prop with a
 * validated `ProjectContactInput` and reports the prop's returned
 * `{ error }` (if any) the same as it would for a real write. Once
 * `createProject()` succeeds and returns the new project's id, Task 4
 * makes ONE follow-up call — `upsertContact(newProjectId, capturedInput)`
 * (the same Server Action `ProjectContactsWorkspace` uses) — before
 * redirecting to the setup screen. If that follow-up call fails, the
 * project itself still exists (creation already succeeded); Task 4's
 * own job is to decide how to surface that partial-failure case (e.g.
 * redirect anyway with a "the project was created, but the contact
 * couldn't be saved — add it from the Setup screen" notice) — not
 * addressed further here since it's Task 4's screen, not this file's.
 *
 * This is why `ProjectContactForm.onSubmit`'s type is
 * `(input: ProjectContactInput) => Promise<{ error?: string } | void>`
 * rather than being hard-wired to the `upsertContact(projectId, ...)`
 * Server Action shape — the same form component has to work with
 * EITHER a real write (workspace context) OR a local capture (create-
 * panel context), and the only thing both contexts share is "take
 * these validated fields and tell me if something's wrong."
 *
 * Styling/structure conventions match ProjectTeamWorkspace.tsx exactly:
 * a trailing `<style dangerouslySetInnerHTML>` block (never a raw
 * `<style>{...}</style>` JSX child — that pattern caused a real
 * hydration-mismatch bug found and fixed twice elsewhere in this
 * codebase this session), inline per-row state, full-replace-on-reload
 * after every mutation (never patched in place).
 */
import React, { useState } from "react";
import { colors, spacing, typography, radius, shadow } from "../design/tokens";
import type {
  ProjectContactRow,
  ProjectContactInput,
  ContactRole,
  ContactMethod,
  ContactInfoStatus,
} from "../services/projectIntakeService";
import { Button, TextInput, Select, Checkbox, Alert } from "./ui";

const ROLE_LABELS: Record<ContactRole, string> = {
  primary_homeowner: "Primary homeowner",
  secondary_homeowner: "Secondary homeowner",
  other_household: "Other household member",
  professional_contact: "Professional contact (architect, engineer, etc.)",
};

const METHOD_LABELS: Record<ContactMethod, string> = {
  email: "Email",
  phone: "Phone",
  text: "Text",
};

const INFO_STATUS_LABELS: Record<ContactInfoStatus, string> = {
  not_started: "Not started",
  requested: "Requested",
  partial: "Partial",
  complete: "Complete",
};

// =====================================================================
// ProjectContactForm — the shared add/edit form. See this file's header
// comment for the full reasoning behind its projectId-agnostic onSubmit
// contract.
// =====================================================================

interface ContactFormValues {
  fullName: string;
  preferredName: string;
  role: ContactRole | "";
  email: string;
  phone: string;
  preferredContactMethod: ContactMethod | "";
  hasDifferentMailingAddress: boolean;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
  isDecisionMaker: boolean;
  isBillingContact: boolean;
  infoStatus: ContactInfoStatus;
}

type ContactDefaults = Partial<ProjectContactInput> & { id?: string | null };

function defaultsToFormValues(defaults?: ContactDefaults | null): ContactFormValues {
  const hasMailingAddress = !!(defaults?.address || defaults?.city || defaults?.state || defaults?.zip);
  return {
    fullName: defaults?.fullName ?? "",
    preferredName: defaults?.preferredName ?? "",
    role: defaults?.role ?? "",
    email: defaults?.email ?? "",
    phone: defaults?.phone ?? "",
    preferredContactMethod: defaults?.preferredContactMethod ?? "",
    hasDifferentMailingAddress: hasMailingAddress,
    address: defaults?.address ?? "",
    city: defaults?.city ?? "",
    state: defaults?.state ?? "",
    zip: defaults?.zip ?? "",
    isPrimary: defaults?.isPrimary ?? false,
    isDecisionMaker: defaults?.isDecisionMaker ?? false,
    isBillingContact: defaults?.isBillingContact ?? false,
    infoStatus: defaults?.infoStatus ?? "not_started",
  };
}

function formValuesToInput(values: ContactFormValues, id?: string | null): ProjectContactInput {
  return {
    id: id ?? null,
    fullName: values.fullName.trim(),
    preferredName: values.preferredName.trim() || null,
    role: values.role || null,
    email: values.email.trim() || null,
    phone: values.phone.trim() || null,
    preferredContactMethod: values.preferredContactMethod || null,
    // Explicit nulls when the "different mailing address" toggle is off
    // -- clears a previously-saved mailing address on an edit, rather
    // than silently leaving stale data behind (pickDefined() in
    // projectIntakeService.ts treats explicit null as "clear this
    // field", undefined as "don't touch it" -- this is deliberately the
    // former).
    address: values.hasDifferentMailingAddress ? values.address.trim() || null : null,
    city: values.hasDifferentMailingAddress ? values.city.trim() || null : null,
    state: values.hasDifferentMailingAddress ? values.state.trim() || null : null,
    zip: values.hasDifferentMailingAddress ? values.zip.trim() || null : null,
    isPrimary: values.isPrimary,
    isDecisionMaker: values.isDecisionMaker,
    isBillingContact: values.isBillingContact,
    infoStatus: values.infoStatus,
  };
}

export interface ProjectContactFormProps {
  /** Present with an `id` => edit mode (the submitted ProjectContactInput
   *  carries that id, so upsertProjectContact() updates the existing
   *  row). Present WITHOUT an `id` => add mode with pre-filled defaults
   *  (e.g. the create panel's quick-add primary-homeowner flow passing
   *  `{ role: "primary_homeowner", isPrimary: true }`). Absent => a
   *  plain blank add form. Parent components that switch which contact
   *  is being edited should remount this component (e.g. `key={row.id}`)
   *  rather than expect it to react to a changed prop after mount. */
  initialContact?: ContactDefaults | null;
  /** Archived-project guard (or "currently submitting elsewhere") --
   *  disables every input and the submit button. Defense-in-depth: the
   *  real boundary is assertProjectNotArchived() inside
   *  upsertProjectContact() itself (projectIntakeService.ts); this is
   *  the UI-hiding half, same "UI hiding is cosmetic, the real check is
   *  elsewhere" framing already used throughout this codebase. */
  isDisabled?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** Deliberately NOT `(projectId, contact) => ...` -- see this file's
   *  header comment. The caller decides what "submit" means: a real
   *  upsertProjectContact() Server Action call for an existing project
   *  (whose success shape includes `{ id }`, harmlessly ignored here),
   *  or a local state capture for a project that doesn't exist yet
   *  (whose success shape can be anything, including `void`). */
  onSubmit: (input: ProjectContactInput) => Promise<{ error?: string; id?: string } | void>;
  /** Called after a successful submit, with the same input that was
   *  submitted. The form resets its own fields back to `initialContact`'s
   *  defaults when NOT editing an existing id (add mode) so the same
   *  form can be used to add another contact; it does not reset in edit
   *  mode (the parent typically closes/unmounts the form instead). */
  onSuccess?: (input: ProjectContactInput) => void;
  onCancel?: () => void;
  /** Default `true` (unchanged standalone behavior: renders its own
   *  `<form onSubmit>`). Pass `false` when this component is mounted
   *  INSIDE another `<form>` -- e.g. ProjectListWorkspace.tsx's inline
   *  create-panel quick-add, nested inside the outer "Create a new
   *  project" `<form>`. A `<form>` nested inside another `<form>` is
   *  invalid HTML: the browser's own HTML parser silently reparents the
   *  inner `<form>`'s children up and out of it (forms cannot nest per
   *  the HTML spec), producing a live DOM structurally different from
   *  what React's server-rendered markup describes -- which is exactly
   *  what throws "Hydration failed because the initial UI does not
   *  match what was rendered on the server". When `false`, this
   *  component renders a plain `<div className="sc-contact-form">`
   *  instead of a `<form>`, and its submit button becomes
   *  `type="button"` wired to the exact same runSubmit() validation/
   *  onSubmit-call logic the `<form onSubmit>` path uses -- no
   *  duplicated logic, just a different trigger (a button click instead
   *  of the browser's native form-submit event, which the outer form's
   *  own onSubmit would otherwise also intercept via bubbling). */
  renderAsForm?: boolean;
}

export function ProjectContactForm({
  initialContact,
  isDisabled,
  submitLabel,
  cancelLabel = "Cancel",
  onSubmit,
  onSuccess,
  onCancel,
  renderAsForm = true,
}: ProjectContactFormProps) {
  const isEdit = !!initialContact?.id;
  const [values, setValues] = useState<ContactFormValues>(() => defaultsToFormValues(initialContact));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Shared by both the `<form onSubmit>` path (renderAsForm=true) and the
  // `<button type="button" onClick>` path (renderAsForm=false) -- see the
  // renderAsForm doc comment above. Takes no event; the two callers each
  // handle their own trigger's event semantics (preventDefault for the
  // form-submit event, nothing needed for a plain button click).
  async function runSubmit(): Promise<void> {
    if (!values.fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const input = formValuesToInput(values, initialContact?.id ?? null);
      const result = await onSubmit(input);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      if (!isEdit) {
        // Add mode: clear back to the same defaults this form started
        // with, so the caller can add another contact without the
        // previous entry's values lingering.
        setValues(defaultsToFormValues(initialContact));
      }
      onSuccess?.(input);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runSubmit();
  }

  const fields = (
    <>
      <div className="sc-contact-form-grid">
        <label className="sc-contact-field">
          <span>Full name*</span>
          <TextInput
            type="text"
            value={values.fullName}
            disabled={isDisabled}
            onChange={(e) => set("fullName", e.target.value)}
          />
        </label>
        <label className="sc-contact-field">
          <span>Preferred name</span>
          <TextInput
            type="text"
            value={values.preferredName}
            disabled={isDisabled}
            onChange={(e) => set("preferredName", e.target.value)}
          />
        </label>
        <label className="sc-contact-field">
          <span>Role</span>
          <Select value={values.role} disabled={isDisabled} onChange={(e) => set("role", e.target.value as ContactRole | "")}>
            <option value="">— not set —</option>
            {(Object.keys(ROLE_LABELS) as ContactRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>
        <label className="sc-contact-field">
          <span>Email</span>
          <TextInput type="email" value={values.email} disabled={isDisabled} onChange={(e) => set("email", e.target.value)} />
        </label>
        <label className="sc-contact-field">
          <span>Phone</span>
          <TextInput type="tel" value={values.phone} disabled={isDisabled} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="sc-contact-field">
          <span>Preferred contact method</span>
          <Select
            value={values.preferredContactMethod}
            disabled={isDisabled}
            onChange={(e) => set("preferredContactMethod", e.target.value as ContactMethod | "")}
          >
            <option value="">— not set —</option>
            {(Object.keys(METHOD_LABELS) as ContactMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </label>
        <label className="sc-contact-field">
          <span>Info status</span>
          <Select
            value={values.infoStatus}
            disabled={isDisabled}
            onChange={(e) => set("infoStatus", e.target.value as ContactInfoStatus)}
          >
            {(Object.keys(INFO_STATUS_LABELS) as ContactInfoStatus[]).map((s) => (
              <option key={s} value={s}>
                {INFO_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <Checkbox
        checked={values.hasDifferentMailingAddress}
        disabled={isDisabled}
        onChange={(e) => set("hasDifferentMailingAddress", e.target.checked)}
        label="Mailing address is different from the project address"
      />

      {values.hasDifferentMailingAddress && (
        <div className="sc-contact-form-grid">
          <label className="sc-contact-field">
            <span>Address</span>
            <TextInput type="text" value={values.address} disabled={isDisabled} onChange={(e) => set("address", e.target.value)} />
          </label>
          <label className="sc-contact-field">
            <span>City</span>
            <TextInput type="text" value={values.city} disabled={isDisabled} onChange={(e) => set("city", e.target.value)} />
          </label>
          <label className="sc-contact-field">
            <span>State</span>
            <TextInput type="text" value={values.state} disabled={isDisabled} onChange={(e) => set("state", e.target.value)} />
          </label>
          <label className="sc-contact-field">
            <span>ZIP</span>
            <TextInput type="text" value={values.zip} disabled={isDisabled} onChange={(e) => set("zip", e.target.value)} />
          </label>
        </div>
      )}

      <div className="sc-contact-flags">
        <Checkbox
          checked={values.isPrimary}
          disabled={isDisabled}
          onChange={(e) => set("isPrimary", e.target.checked)}
          label="Primary contact"
        />
        <Checkbox
          checked={values.isDecisionMaker}
          disabled={isDisabled}
          onChange={(e) => set("isDecisionMaker", e.target.checked)}
          label={
            <>
              Decision-maker
              <em> — informational only: tells staff who to ask. Confers no approval authority.</em>
            </>
          }
        />
        <Checkbox
          checked={values.isBillingContact}
          disabled={isDisabled}
          onChange={(e) => set("isBillingContact", e.target.checked)}
          label="Billing contact"
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="sc-contact-form-actions">
        <Button
          type={renderAsForm ? "submit" : "button"}
          loading={submitting}
          loadingText="Saving…"
          disabled={isDisabled}
          onClick={renderAsForm ? undefined : runSubmit}
        >
          {submitLabel ?? (isEdit ? "Save changes" : "Add contact")}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </>
  );

  // renderAsForm=false renders a plain <div> instead of a <form> -- see
  // the renderAsForm doc comment on ProjectContactFormProps for why (a
  // nested <form> inside ProjectListWorkspace.tsx's outer create-project
  // <form> is invalid HTML and causes a real hydration mismatch).
  if (!renderAsForm) {
    return <div className="sc-contact-form">{fields}</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="sc-contact-form">
      {fields}
    </form>
  );
}

// =====================================================================
// ProjectContactsWorkspace — the full list + management view (Setup
// screen's "Homeowners & decision-makers" section, design §9).
// =====================================================================

export interface ProjectContactsWorkspaceProps {
  projectId: string;
  projectName: string;
  /** Defense-in-depth UI guard -- see ProjectContactForm's own doc
   *  comment. The page rendering this component (contacts/page.tsx)
   *  already blocks the whole route for an archived project via
   *  NoProjectAccess, matching /team and /setup's established pattern,
   *  so this prop is not expected to ever be true in practice today --
   *  kept so this component degrades safely if ever reused somewhere
   *  that doesn't page-block first. */
  isArchived?: boolean;
  contacts: ProjectContactRow[];
  upsertContact: (projectId: string, contact: ProjectContactInput) => Promise<{ id: string } | { error: string }>;
  refreshContacts: (projectId: string) => Promise<{ contacts?: ProjectContactRow[]; error?: string }>;
}

function formatBool(value: boolean): string {
  return value ? "Yes" : "—";
}

export function ProjectContactsWorkspace({
  projectId,
  projectName,
  isArchived,
  contacts: initialContacts,
  upsertContact,
  refreshContacts,
}: ProjectContactsWorkspaceProps) {
  const [contacts, setContacts] = useState<ProjectContactRow[]>(initialContacts);
  const [listError, setListError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Never patches state in place -- every successful mutation is
  // followed by a full re-fetch whose result wholesale-replaces
  // `contacts`, same discipline as ProjectTeamWorkspace's reload().
  async function reload() {
    const result = await refreshContacts(projectId);
    if (result.error) {
      setListError(result.error);
      return;
    }
    setListError(null);
    setContacts(result.contacts ?? []);
  }

  async function handleUpsert(input: ProjectContactInput) {
    return upsertContact(projectId, input);
  }

  return (
    <div className="sc-contacts-workspace">
      <h2>{projectName} — Homeowners &amp; Contacts</h2>
      {listError && <div className="sc-contact-error">{listError}</div>}

      {contacts.length === 0 ? (
        <p className="sc-contacts-empty">No contacts recorded for this project yet.</p>
      ) : (
        <div className="sc-contacts-table-scroll">
          <table className="sc-contacts-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Role</th>
              <th style={{ textAlign: "left" }}>Email</th>
              <th style={{ textAlign: "left" }}>Phone</th>
              <th style={{ textAlign: "left" }}>Primary</th>
              <th style={{ textAlign: "left" }}>Decision-maker</th>
              <th style={{ textAlign: "left" }}>Billing</th>
              <th style={{ textAlign: "left" }}>Info status</th>
              <th style={{ textAlign: "left" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) =>
              editingId === c.id ? (
                <tr key={c.id}>
                  <td colSpan={9}>
                    <ProjectContactForm
                      key={c.id}
                      initialContact={c}
                      isDisabled={!!isArchived}
                      submitLabel="Save changes"
                      onSubmit={handleUpsert}
                      onSuccess={async () => {
                        setEditingId(null);
                        await reload();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td>
                    {c.fullName}
                    {c.preferredName && <span className="sc-contacts-hint"> ({c.preferredName})</span>}
                  </td>
                  <td>{c.role ? ROLE_LABELS[c.role] : "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{formatBool(c.isPrimary)}</td>
                  <td>{formatBool(c.isDecisionMaker)}</td>
                  <td>{formatBool(c.isBillingContact)}</td>
                  <td>{INFO_STATUS_LABELS[c.infoStatus]}</td>
                  <td>
                    {!isArchived && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => setEditingId(c.id)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
          </table>
        </div>
      )}

      {isArchived ? (
        <p className="sc-contacts-hint">This project is archived. Contacts are read-only.</p>
      ) : addOpen ? (
        <div className="sc-contacts-add-panel">
          <h3>Add a contact</h3>
          <ProjectContactForm
            key="add"
            submitLabel="Add contact"
            onSubmit={handleUpsert}
            onSuccess={async () => {
              await reload();
            }}
            onCancel={() => setAddOpen(false)}
          />
        </div>
      ) : (
        <Button type="button" onClick={() => setAddOpen(true)}>
          Add contact
        </Button>
      )}

      <style dangerouslySetInnerHTML={{ __html: contactsStyles }} />
    </div>
  );
}

const contactsStyles = `
.sc-contacts-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-contacts-workspace h2 { margin: 0 0 ${spacing.lg} 0; }
.sc-contacts-empty { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-contacts-hint { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; }
/* Bordered/shadowed "card" treatment wraps the scroll container, not the
   <table> element directly (border-radius doesn't clip cleanly through a
   collapsed-border table's own cell borders) -- same pattern
   BudgetTable.tsx/EstimateTable.tsx already settled on for a table with no
   dedicated shared Table primitive yet. overflow-x lets a wide table
   scroll horizontally on its own on narrow viewports. */
.sc-contacts-table-scroll { border: 1px solid ${colors.line}; border-radius: ${radius.lg}; overflow-x: auto; background: ${colors.white}; box-shadow: ${shadow.sm}; margin-bottom: ${spacing.md}; }
.sc-contacts-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; min-width: 640px; }
.sc-contacts-table th { padding: ${spacing.sm} ${spacing.sm}; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; font-weight: ${typography.weightSemibold}; text-transform: uppercase; letter-spacing: 0.02em; background: ${colors.paperDim}; }
.sc-contacts-table td { padding: ${spacing.sm} ${spacing.sm}; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; color: ${colors.ink2}; }
.sc-contacts-table tbody tr:last-child td { border-bottom: none; }
.sc-contacts-table tbody tr:hover td { background: ${colors.paperDim}; }
.sc-contacts-add-panel { background: ${colors.paperDim}; border-radius: ${radius.md}; padding: ${spacing.md}; margin-top: ${spacing.sm}; }
.sc-contacts-add-panel h3 { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeMd}; }
.sc-contact-form { display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-contact-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: ${spacing.sm}; }
.sc-contact-field { display: flex; flex-direction: column; gap: 4px; font-size: ${typography.sizeXs}; color: ${colors.ink2}; }
.sc-contact-field input, .sc-contact-field select { padding: 6px 8px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; }
/* ProjectContactForm's checkboxes now render via the shared ui/ Checkbox
   primitive (sc-ui-checkbox / sc-ui-checkbox-label) instead of this file's
   own sc-contact-checkbox wrapper -- this rule only restyles the
   decision-maker help text's <em>, which the shared primitive has no
   opinion on. */
.sc-ui-checkbox-label em { display: block; font-style: normal; color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; }
.sc-contact-flags { display: flex; flex-direction: column; gap: ${spacing.xs}; background: ${colors.paperDim}; border-radius: ${radius.md}; padding: ${spacing.sm}; }
.sc-contact-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin-top: 4px; }
.sc-contact-form-actions { display: flex; gap: ${spacing.sm}; }
`;
