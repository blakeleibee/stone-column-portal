# P5 Extension Packages — Vendor Management, Bid/Document Collaboration, Material-Order Collaboration, Financial Traceability

**Status: Owner-approved, 2026-09-04, with the six final decisions recorded in Section 9 and reflected throughout this document.** Implementation proceeds package by package, in the sequence fixed in Section 4, starting with P5.0. Later packages (P5.1 onward) require a separate owner preview/approval checkpoint before they begin — approval of this document authorizes the design and the sequence, not a green light to build everything at once.

**Trigger:** Owner feedback from the final P5 live preview, 2026-09-03. Full feedback preserved in conversation history; this document is the requested response to its "Required output before implementation" section (12 items) and its 11 numbered requirement areas.

**Scope of this document:** research findings (grounded in the real codebase, cited by file:line, since re-verified by an independent reviewer including two live-database checks), a proposed set of four P5-dependent sub-packages, and the consequential decisions the owner needs to make. **Nothing here is implemented.** P5 itself remains open (not merged, tagged, or closed) and unaffected by this document except where explicitly noted.

---

## How to read this document

| Owner's numbered requirement area | Answered in |
|---|---|
| #1 Vendor directory and onboarding | Section 5, P5.1 |
| #2 Bid-package assembly and document control | Section 5, P5.2 Part B–C |
| #3 Email invitations and secure vendor access | Section 5, P5.2 Part D |
| #4 Bid communication and correspondence | Section 5, P5.2 Part E |
| #5 Vendor bidding experience | Section 5, P5.2; Section 10 |
| #6 Awarded bid and project financials | Section 5, P5.4; Section 9 item 3 |
| #7 Material-order collaboration | Section 5, P5.3 |
| #8 Traceability / the missing verification amounts | Section 3 |
| #9 Reduce duplicate entry | Section 6 |
| #10 Future AI readiness | Section 7 |
| #11 Navigation | Section 8 |

| Owner's "required output" item | Answered in |
|---|---|
| 1. Plain-English explanation of what exists today | Section 1 |
| 2. Gap matrix | Section 2 |
| 3. Recommended package boundaries and dependencies | Section 4 |
| 4. Exact placement of vendor management | Section 4, 5 (P5.1) |
| 5. Exact placement of email/vendor access/documents/correspondence/inbound replies | Section 4, 5 (P5.2) |
| 6. Consequential owner decisions with recommendations | Section 9 |
| 7. Screen-level workflows | Section 10 |
| 8. Database/security implications | Section 11 |
| 9. Migration and compatibility considerations | Section 12 |
| 10. Acceptance criteria and verification strategy | Section 13 |
| 11. Estimated implementation time by package | Section 14 |
| 12. Independent-review findings and resulting revisions | Section 15 |

---

## 1. What the current system actually does today (plain English)

Every claim below is sourced from a direct reading of the real code, not documentation or memory, and has since been independently re-verified (Section 15).

**Publish.** Clicking "Publish" on a bid package is real — it flips `bid_packages.status` from `draft` to `published` via a genuine database update (`bidService.ts` `publishBidPackage`). Nothing about it is a stub.

**Invite.** Clicking "Invite" on a vendor is real in the sense that it writes a genuine `bid_submissions` row linking that vendor to that package (`bidService.ts` `inviteVendor`). **It does not send an email.** There is no email-sending capability anywhere in this codebase — no provider library in any `package.json`, no SMTP configuration wired to app code (Supabase's local dev SMTP inbox and a commented-out SendGrid boilerplate block in `supabase/config.toml` are the only "smtp" hits in the entire repo, neither reachable from application code). "Invite" today means: a staff member picks a vendor from a dropdown of vendors already in the system, and the system silently records that this vendor was invited. The vendor is told nothing.

**Vendor access.** There is no vendor-facing UI. `apps/web/app/vendor/page.tsx` is a single static page that literally tells a signed-in vendor: *"the vendor portal is not built yet... planned for a later package."* A vendor cannot log in and see a bid package, ask a question, or submit a price, because no screen exists for any of that. Everything that looks like "the vendor did X" in the current system (a submitted bid, a question, an answer) was actually typed in by Stone Column staff on the vendor's behalf, directly in the admin screen (`bidService.ts` `recordBidSubmission`/`askBidQuestion`, both explicitly documented in their own code comments as staff-entered because "P5 has no vendor session to submit directly").

**Submissions.** Recording a bid amount for a vendor, awarding a submission, and issuing the resulting subcontract are all real, persisted operations — a real `award_bid()` database function, a real `issue_document()` function producing a versioned, immutable snapshot. None of this is fake. What's missing is only the vendor's own ability to do these things themselves.

**Messaging.** The only real two-way communication mechanism in the whole codebase is bid Q&A (`bid_questions`/`bid_addenda`). Today it is staff-only in both directions (staff records the question on the vendor's behalf, staff answers it) — the schema already has an RLS policy that would let a real vendor session submit its own question, but that policy is explicitly commented in the migration as *"dormant until P11: no vendor session exists in P5 to exercise this insert path."* By default, every vendor invited to a package can see every question and answer on that package (not just their own) — there is a flag to make a specific question private to one vendor, but it must be set explicitly; the default is broadcast.

**Documents.** There is no document-upload capability wired to any screen today, for bids, material orders, or anything else. This is a more interesting gap than "nothing exists" — a real document metadata table (`documents`), a real file-storage abstraction (`StorageAdapter`, with a genuinely working local-filesystem implementation and a stubbed OneDrive implementation), and a real download route all exist in the code, built as groundwork in an earlier package — but nothing ever calls the upload half (confirmed: zero call sites for `.upload()` anywhere in the codebase). The authorization check for uploading a document (`canUploadDocument`) is defined but never called anywhere in the app. So today, "attach a document" is not possible from any screen, even though roughly 70% of the plumbing to make it possible already exists, unused.

**Award.** Awarding a bid or committing a material order is real: it creates a genuine `committed_costs` row with an integer-cents amount, the correct cost code, and a marker of which bid or order produced it — confirmed directly from `award_bid()`/`commit_material_order()`'s own SQL bodies, neither of which writes to `budget_ledger`. The Estimate/Budget screen's project-level "Committed" total genuinely includes these amounts — this is not a disconnected number. What's missing is display, not math: the per-cost-code budget table doesn't show a Committed column at all (only the four project-level summary cards do), and nothing on any screen turns "$5,000 committed" into a clickable link back to the specific bid submission or material order that produced it, or forward from that bid/order to the specific commitment row it produced.

**PDFs.** Issuing a purchase order or subcontract is real and genuinely versioned — the system freezes an exact JSON snapshot at the moment of issuance and will always render that exact snapshot again later, even if the underlying live data changes afterward, via a real immutability trigger at the database level that blocks any row from being edited after creation. Re-issuing creates a real, new, incrementing version, and old versions remain viewable. Before something is ever issued, "View PDF" shows a live draft clearly watermarked as such. None of this is faked.

---

## 2. Gap matrix

| Area | Status | Evidence |
|---|---|---|
| Create/publish bid package | **Working** | Real DB writes, `bidService.ts` |
| Award bid → commitment | **Working** | Real RPC, integer cents, correct cost code, confirmed never touches `budget_ledger` |
| Issue/reissue PO & subcontract PDFs | **Working** | Versioned, immutable, real rendering |
| Financial engine including committed costs | **Working** | `budget.ts` already sums `committed_costs` into projected final cost |
| Record a vendor's bid, ask/answer a question (staff-entered) | **Working, but misleading UI** | The UI doesn't disclose that "the vendor" never touched this |
| "Invite" a vendor | **Misleading UI** | Looks like an email was sent; only a database row was written |
| Bid amount visible after award | **Working** | Shown on both the Bids screen and Commitments screen |
| Budget screen shows committed dollars | **Partially working** | Included in project totals; absent from the per-cost-code table |
| Commitment ↔ source bid/order cross-navigation | **Missing** | No link either direction, confirmed on every relevant screen |
| Vendor bidding experience (login, view package, submit, ask question) | **Missing entirely** | No vendor UI exists at all |
| Vendor email invitations | **Missing entirely** | No email infrastructure anywhere in the codebase |
| Bid package documents (upload, link, version) | **Missing, but ~70% of the plumbing already exists unused** | `documents` table + `StorageAdapter` + download route exist; no upload path, nothing links a document to a bid package |
| Bid package correspondence beyond Q&A | **Missing entirely** | No messages/threads table exists |
| Material order comments/collaboration | **Missing entirely** | No comments table; system-activity history is implicitly available via `audit_log` but never surfaced |
| Vendor directory / onboarding UI | **Missing entirely** | `vendors` table exists, zero UI |
| Vendor duplicate detection | **Missing entirely** | No fuzzy or even exact-match vendor dedup exists |
| Vendor compliance documents (W-9, COI, licensing) | **Missing entirely, unspecified anywhere** | Named only as a placeholder table (`vendor_compliance`) in P11 with zero field design |
| Real vendor RLS access to an invited bid package | **Latently broken** | `inviteVendor` never creates the `project_members` row `is_project_vendor()` requires — a real vendor session invited today would be denied read access to the bid package itself |
| Action Center conditions for bids/backorders | **Spec'd, never built** | P5's own Task 11 was written into the implementation plan and never implemented — no file exists |
| P5's own closeout (Task 12) | **Not done** | Final verification/milestone-closeout task never run |

---

## 3. Traceability investigation (owner's item #8) — root cause, confirmed against hosted dev, re-confirmed independently

**This was investigated live, with real authenticated queries against the real hosted dev database — twice, by two independent passes — not inferred from code alone.**

**The $5,000 and $250 rows are real, correctly computed, and correctly rendered by the code that exists.** Both are genuine `committed_costs` rows on the "CDP Smoke Test 1787776431563" project, status `open`, correct cost code, correct amounts. The query that loads the Commitments screen filters only by project — no status filter at the query level, no pagination, no limit. The grouping logic in the Commitments table would render both rows as their own group. The Bids screen independently shows the same $5,000 amount on the awarded submission's own row, with a badge and a banner linking to Commitments. **This is not a query bug, not a filtering bug, and not a missing-display bug** — every place you'd expect to see these numbers, given the correct project selected, does show them.

**The actual cause is project selection, compounded by confusing test data.** Two failure modes were confirmed, both reachable in ordinary use:

1. **No project cookie set** (e.g., a fresh browser session): the app silently defaults to whichever project sorts first alphabetically by name — in the live org, that's a project ("Blake Leibee") with zero commitments, confirmed directly. Bids and Commitments would both appear empty, with nothing on screen indicating *why*.
2. **Wrong project selected among near-duplicates**: the org has two projects both named "CDP Smoke Test `<numeric timestamp>`" — differing only in a long digit string, confirmed to both exist. Landing on the sibling project instead shows *different, and in one case absurd* committed-cost numbers — a real, confirmed row exists there with an amount of $2,025,000,000, leftover test data from an earlier task (itself a data-hygiene problem worth cleaning up separately, not addressed by this design). A owner scanning for "$5,000" against that screen would reasonably conclude the number is simply missing.

Both failure modes are real, current behavior — not hypothetical. **Neither is necessarily what the owner's own session hit specifically** (either or both are plausible), but the underlying application defect is the same either way: nothing on the Bids or Commitments screen makes the currently-selected project unmistakable, and there is no safeguard against silently rendering the wrong project's (or no project's) data.

**A second, independent, and equally real gap was found during this same investigation: there genuinely is no cross-navigation from a commitment back to its source bid/order, or forward from an awarded bid/committed order to the specific commitment row it produced** (only a generic link to the Commitments list page, confirmed on every relevant screen). This is a real, separate defect worth fixing regardless of the project-selection issue, and is addressed by Section 5's P5.4 proposal below.

**Both issues are addressed in P5.4** (Section 5): a more prominent, harder-to-miss "you are viewing `<project>`" treatment on the three P5 screens specifically, a safeguard against silently rendering these screens against an unexpected project, and real hyperlinks in both directions between commitments and their source records.

---

## 4. Recommended package boundaries and approved sequencing

**Owner-approved final sequence, 2026-09-04:**

```
P5.0 — Project-Context Write-Safety                       [IMPLEMENTING NOW]
   │   small, no new tables, fixes the write-safety defect found in Section 3
   │
P5 Task 11 — Action Center conditions (per original approved scope)
   │
P5 Task 12 — Final verification & closeout (P5 formally tagged complete here)
   │
   ▼  ── owner preview/approval checkpoint before continuing ──
P5.1 — Vendor Directory & Onboarding
   │
P5.2 — Vendor Bid Access, Documents, Email Invitations & Correspondence
   │    depends on: P5.1, P3's vendor RLS foundation
   │
P5.3 — Material Order Collaboration & Documents
   │    depends on: P5.2 (reuses its document-storage extension and its generic
   │    entity-scoped messages table, and its inbound-email infrastructure)
   │
P5.4 — Financial Traceability, Cross-Navigation
        depends on: P5 (Commitments/Bids/Financials screens already shipped)
```

**Why P5.0 moved ahead of everything, including P5's own outstanding tasks:** this was originally scoped as part of P5.4 (a display-clarity improvement), but re-examined against the owner's sharper framing: the silent "default to whichever project sorts first" behavior isn't just a display problem, it's a **write-safety** problem — nothing stops a create action from landing under the wrong project today. P5.1 doesn't depend on project context at all (vendors are organization-level, not project-scoped), so extracting this costs nothing in delay and protects every subsequent package's new write paths (P5.2's invitations, P5.3's material orders) from inheriting the same risk. P5.4 keeps everything else originally scoped to it — the bid/order-to-commitment cross-links and the per-cost-code Committed/Projected columns — unchanged; only the project-context-clarity slice moved out and earlier.

**Why P5's own Task 11/12 sit right after P5.0, not after P5.4 as originally suggested:** P5's own closeout verification should not run while the exact project-selection confusion that prompted this whole conversation is still live — running it immediately after P5.0 means the final verification pass is itself trustworthy, and P5 gets formally tagged complete promptly rather than staying open through four more packages' worth of work. This also closes the loop on the owner's standing "do not close/merge/tag P5 yet" instruction with a concrete next step, not an indefinite hold.

An owner preview/approval checkpoint sits between Task 12's closeout and the start of P5.1 — approval of this document authorizes the design and sequence, not unattended execution through all five remaining phases.

**P11 (Vendor Portal) is reconciled, not replaced.** P5.2 takes over the bid-specific slice of what P11's roadmap entry described ("Bid Management (vendor-side)"), including the inbound-email correspondence infrastructure (Section 5, P5.2 Part E) — a natural extension of the same "vendor-side bid experience" P11 was always going to need, built earlier because P5.2 needs it now. What remains in P11, unchanged: `vendor_profiles`, `vendor_assignments`, `vendor_performance_notes`, `vendor_invoices`, `vendor_change_requests`, and 1099 export — the vendor's own account/assignment/performance/invoicing experience beyond bidding. **`vendor_compliance` — the sixth table P11's roadmap entry originally named — is not carried forward at all: its intended scope (W-9/certificate-of-insurance/licensing tracking) is fully absorbed by P5.1's new `vendor_documents` table instead.**

---

## 5. Package-by-package design

### P5.0 — Project-Context Write-Safety

**Owner-approved, implementing first.** No new tables — this is a fix to shared, cross-cutting behavior every project-scoped page already depends on, plus a server-side safety net on every affected write path.

**Requirements, as approved:**
- Unmistakable current project name and number on every project-scoped page — a prominence/clarity fix to the project switcher already present in the shared `AppShell` header (built during earlier navigation work), not a new component per screen.
- No silent first-project fallback — `resolveSelectedProject()` (the one shared function every project-scoped page already calls) stops defaulting to whichever project sorts first alphabetically when no cookie is set.
- An explicit no-project-selected state — a real "select a project to continue" screen in place of that silent fallback, for every project-scoped route.
- No project-scoped write without an explicitly selected, authorized project — every create/write Server Action re-derives the target project from the trusted server-side session state (never trusts a client-supplied project id alone), and refuses to proceed if no project is unambiguously selected.
- Server-side validation of the target project for every affected create/write action — re-checked against the acting user's real access (the same RLS-backed `listAccessibleProjects()` check `switchProject()` already uses), not merely inferred from whatever the UI happened to display.
- The target project identified clearly at the final action point — every "Create" action names the project it's about to write into directly on the button/confirmation (e.g., "Create Bid Package for Hawks Ridge Residence"), so the last moment before a write happens still confirms it.
- Existing project switching remains predictable — `switchProject()`'s current behavior (stays on the same route, re-renders for the new project) is unchanged; this package fixes what happens when nothing has been explicitly switched to yet, not the switching mechanism itself.
- No records silently created under another project — the combination of the above (no silent fallback, explicit empty state, server-side re-validation) means a create action can no longer succeed against an unintended project even if the client-side state were somehow wrong or stale.

**Scope boundary:** this package touches shared infrastructure (`resolveSelectedProject`, `AppShell`'s project-switcher header, the Server Action layer's project-resolution pattern) and every existing create/write action that depends on it. It does not add any new page, table, or vendor-facing surface — P5.1 remains unaffected by it (vendors are organization-scoped, not project-scoped) and can proceed independently once P5.0 lands.

### P5.1 — Vendor Directory & Onboarding

**Answers owner item #1.** Closes `PRODUCT-COMPLETENESS-MATRIX.md` Section D's "no admin-side UI to create/manage a `vendors` row" row.

**Scope:** an org-level vendor management workflow. Company/legal name, active/inactive status, trades/service categories, primary bidding contact + additional contacts, phone/address, preferred communication method, service area, W-9 status + document, certificate of insurance + expiration + document, licensing info, payment terms, internal notes, cross-linked history (every bid/award/subcontract/material-order this vendor has ever touched), duplicate detection at creation, role-appropriate access, full audit history.

**Explicitly kept simple, per owner instruction:** the creation form asks only for name + email + phone (matching the field set already proven sufficient for every vendor created so far). Everything else — trades, contacts, compliance documents, payment terms, notes — lives in a **secondary-information area organized into clearly labeled sections** (Contacts, Compliance & Licensing, Payment Terms, Internal Notes, History) on the vendor's own detail screen, filled in progressively, never required at creation.

**Schema (sketch — exact DDL is implementation-time work, not this document's job):**

- **`vendors`** (existing table, unchanged in shape) gains: `legal_name text`, `trades text[]` (a simple tag array — this codebase has no precedent for fuzzy/categorical trade taxonomies yet, and the owner's own instruction is to keep this simple; a normalized `trades` lookup table is a reasonable future upgrade if search/filter needs demand it, not now), `service_area text`, `preferred_communication_method text`, `payment_terms text`. **`is_active` reuses the existing `is_archived` column, inverted, rather than adding a redundant second status column** — this matches the codebase's existing "archive instead of delete" philosophy exactly and avoids two overlapping concepts of "gone." The existing `contact_name`/`email`/`phone` columns on `vendors` remain and become a denormalized mirror of whichever `vendor_contacts` row is flagged primary — kept in sync by the same service function that writes `vendor_contacts`, never edited independently — so every existing query that already reads `vendors.contact_name`/`email`/`phone` (bid invites, material-order vendor selection) keeps working unchanged, while `vendor_contacts` becomes the one real source of truth going forward.
- **`vendor_contacts`** (new): `id`, `vendor_id` (FK), `name`, `title`, `email`, `phone`, `is_primary_bidding_contact boolean`, `notes`, `created_by`, `created_at`. Modeled on the *design* already written for `project_decision_makers` (`CLIENT-APPROVAL-MODEL.md`) — that table is itself not yet implemented anywhere in this codebase, so "precedent" here means a proven design pattern (contact-plus-role child table, never deleted, only ended), not existing working code to extend. This design is simpler than decision-makers need, since contacts here don't require an effective-dated authority model: a plain child table, archived not deleted (same `reject_delete` + `revoke delete` pattern every other vendor table already uses).
- **`vendor_documents`** (new): `id`, `vendor_id` (FK), `org_id`, `category` (`w9`/`certificate_of_insurance`/`license`/`other`), `expiration_date` (nullable — used for COI/license), `storage_key`, `mime_type`, `size_bytes`, `uploaded_by`, `created_at`, `excluded_from_indexing boolean not null default true`, plus the same `version`/`superseded_by_id` pair being added to the base `documents` table by P5.2 (Section 5, P5.2 Part C) — **reuses the exact same `StorageAdapter` interface and `LocalFilesystemStorageAdapter`/`OneDriveStorageAdapter` implementations already built and sitting unused**, just against a vendor-scoped table instead of the project-scoped `documents` table (vendors are org-level, not project-level, so a parallel table is cleaner than making `documents.project_id` nullable). **This table absorbs the entirety of P11's originally-named `vendor_compliance` table** — see Section 4.

**W-9 documents get materially stricter handling than COI/license, per the owner's explicit decision — a category-conditional treatment, not a blanket vendor-document policy:**
- **Access restricted to authorized admin/accounting roles specifically, not all org staff.** `vendors`/`vendor_contacts`/the rest of `vendor_documents` stay on the existing `is_org_staff_for_org()` policy (the normal staff-wide access every other vendor-domain table already uses), but a `category = 'w9'` row is additionally gated by a new, narrower helper — this requires extending the existing `staff_function` taxonomy (already the mechanism `is_financial_staff()` uses to exclude superintendents) with an explicit accounting/admin marker, so the check is a real, tested role distinction, not a naming convention. COI/license rows stay on the ordinary staff-wide policy, since insurance/license status is routinely needed by staff who aren't accounting (e.g., confirming a subcontractor's insurance before a site visit) — the owner's instruction to "treat COI/license visibility separately" means specifically: do not lump them into the W-9 restriction, not that they need a new restriction of their own.
- **Private storage with expiring downloads, not a permanent link.** `StorageAdapter.getDownloadUrl()` must produce a **time-limited, signed URL for `category='w9'` documents specifically** — the current dev-only `LocalFilesystemStorageAdapter` will need this capability added (it does not have it today), and it is a hard requirement (not optional) for whichever production adapter (OneDrive/Microsoft Graph, which supports short-lived download URLs natively) eventually replaces it.
- **Every access is audited, not just every write.** This is a new pattern this codebase doesn't have yet — the standard `log_audit_no_project()` trigger only fires on insert/update/delete, and a W-9 *download* is a read, not a mutation. A W-9-specific download endpoint must make an explicit, separate audit write (`table_name='vendor_documents'`, `action='downloaded'`) at the moment a signed URL is issued, so "who looked at this W-9 and when" is a real, queryable record, not an inference.
- **Excluded from OCR, general search, and future AI indexing.** The `excluded_from_indexing` column (default `true`) is a standing instruction to any future indexing code, not a currently-enforced mechanism, since no search/OCR/AI-indexing pass exists anywhere in this codebase yet (confirmed — `AI-ASSISTANT-ARCHITECTURE.md` explicitly defers document search-readiness work to P15). **This document records the requirement now, for `AI-ASSISTANT-ARCHITECTURE.md` to carry forward:** whenever P15 (or any earlier package) builds a document-indexing pass, it must check this column and skip `category='w9'` rows unconditionally, not merely by convention. This is a documentation cross-reference to add when `AI-ASSISTANT-ARCHITECTURE.md` is next touched, not new code to write now.
- **Duplicate detection:** exact-normalized-match only (lowercase, trim, strip common suffixes like "LLC"/"Inc" for the name comparison; exact match on email) at creation time, surfaced as a **warning the staff member can override**, never a hard block — this matches the only existing precedent in the codebase (P4's QuickBooks import duplicate-expense detection, which is exact-key matching, not fuzzy). True fuzzy/similarity matching is a reasonable future upgrade, explicitly not v1.
- **Sensitive data — explicit boundary, per owner instruction:** W-9/insurance/licensing information lives as an **uploaded document plus a status/expiration date**, never as structured plain-text fields for the sensitive content itself (no bank routing/account number field, no SSN/EIN field anywhere in this design). If the business later needs to store actual banking or tax-ID numbers as queryable data rather than inside a PDF, that is a new, explicit, separate security decision (field-level encryption or a dedicated compliant subprocessor) — flagged in Section 9, not designed here.

**RLS/audit:** `is_org_staff_for_org(org_id)` for all four tables (matching `vendors`' own existing policy exactly), `log_audit_no_project()` trigger on each (org-scoped, not project-scoped — matching `vendors`/`vendor_members`'s existing pattern), delete-blocked via `reject_delete()` + `revoke delete` on all four (matching every other vendor-domain table). No vendor-facing RLS at all in this package — this is 100% an internal admin tool; a vendor's own visibility into their own profile is P5.2/P11 territory, not this one.

**Vendor history view:** no new table — a read-only screen querying `bid_submissions`/`committed_costs`/`issued_documents`/`material_orders` filtered by `vendor_id`, reusing existing repository functions.

**Cross-navigation from Bids/Material Orders, owner-approved 2026-09-09: the vendor model stays single and organization-level — no duplication, no project-specific vendor records.** `BidPackageWorkspace.tsx`'s and `MaterialOrderWorkspace.tsx`'s existing vendor `<select>` (already reading from the one real `vendors` table, unchanged) gains a small "Add Vendor" / "Manage Vendors" link beside it, pointing at P5.1's directory screen. This is a navigation convenience only — clicking it leaves the current bid package or material order exactly as it was, takes the user to the organization-level directory to create or edit a vendor, and relies on the existing screens' own data reload (already re-fetched on next visit) to pick up a newly-created vendor in the selector afterward. No new table, no new vendor concept scoped to a project or a bid package — this is explicitly the requirement this decision protects against.

### P5.2 — Vendor Bid Access, Documents, Invitations & Correspondence

**Answers owner items #2, #3, #4, #5, and the vendor-RLS-access bug found in Section 1.**

**Part A — fix the latent RLS bug.** `inviteVendor` must also upsert a `project_members` row (`member_role='vendor'`) for the invited vendor's linked profile, so `is_project_vendor()` — required by `bid_packages_vendor_read` — actually succeeds. This is a precise, small fix, not a redesign; it was found by tracing the existing RLS policy chain against the existing invite code, and it means every real vendor session invited *today* would currently be denied read access to the bid package itself even after all the UI work below ships, unless this is fixed alongside it.

**Part B — real bid package assembly.** `bid_packages` gains: `scope_description` (already exists), plus `inclusions text`, `exclusions text`, `alternates text`, `allowances text`, `pricing_breakdown_instructions text`, `schedule_expectations text`, `bid_instructions text`, `stone_column_contact_id` (FK to a staff profile). All nullable, direct columns — none of these need independent versioning beyond what the package row itself already has, so an extension table would be unjustified complexity. Internal notes stay on the existing `bid_packages.notes` equivalent (never vendor-visible — enforced by RLS, not by UI hiding, per the codebase's own non-negotiable).

**Part C — document control, built by extending the existing (currently unused) document infrastructure rather than inventing a new one.** This is the highest-leverage finding from research: `documents` (schema/010), `StorageAdapter`, and a real download route already exist, fully unused.
- `documents` gains `version integer not null default 1` and `superseded_by_id` (self-FK), mirroring `issued_documents`' already-proven immutable-versioning pattern exactly — re-uploading a revised file creates a new version row rather than mutating the old one. This addition doesn't collide with anything: `documents` has no existing version concept today.
- A real upload Route Handler is added (the only missing piece — `canUploadDocument` already exists and is already correctly written, just never called).
- **`bid_package_documents`** (new): `id`, `bid_package_id`, `document_id` (FK, pinned to a specific *version*, never "whichever is latest"), `internal_only boolean`, `created_by`, `created_at`. Publishing a package snapshots exactly which document versions were included — a later document re-upload never silently changes what an already-published package points to; distributing an update means issuing an addendum that links the new version, exactly matching the owner's "versioned addenda, not silent replacement" instruction.
- Vendor read access to a linked document requires **both** existing gates already proven in this codebase (`is_project_vendor()` AND `is_invited_vendor_for_bid_package()`) **and** the join row not being `internal_only` — never blanket project-document access, matching the owner's explicit instruction and the codebase's own established double-gate vendor-visibility pattern (already used identically for `bid_packages`/`bid_submissions`/`bid_addenda`).

**Part D — real email invitations.** New infrastructure, since none exists today.
- **`bid_invitation_emails`** (new): `id`, `bid_submission_id` (FK), `recipient_email` (frozen at send-time from `vendors.email` via the primary bidding contact, per the owner's "sent to the stored bidding email... without re-entering" instruction — but copied at send time, not a live reference, so a later change to the vendor's email doesn't rewrite history of who a past invitation actually went to), `sent_at`, `delivery_status` (`sent`/`delivered`/`failed`/`bounced` — populated by provider webhook where the provider supports it, `sent`-only otherwise), `opened_at` (**set by real portal activity — the vendor's authenticated session first loading that specific package — never an email open-pixel**, matching the owner's explicit "reliable portal activity" instruction and the general "never claim delivery that didn't happen" instruction; this is implementable with data already available — the vendor's session is authenticated and scoped to exactly one package by design, so "first load of this package by this vendor" is a real, unambiguous, already-logged event, not a new tracking mechanism), `access_token_hash`, `expires_at`, `revoked_at`, `resent_from_id` (self-FK, so a resend chain is traceable).
- Reuses the existing `invitations` table's magic-link pattern (schema/009, already used for staff onboarding) as the closest in-codebase precedent for "an unauthenticated recipient clicks a link and lands in an authenticated vendor session" — extended for a **package-specific** destination and **vendor-role** account creation, rather than inventing a new auth flow. First click either logs an existing `vendor_members` profile in directly or walks a new vendor contact through Supabase Auth sign-up scoped to that one vendor.
- **Provider decision, owner-approved:** Resend, accessed only through a new internal `EmailService` interface (a thin adapter, matching the `StorageAdapter` pattern this codebase already established for exactly this reason) — nothing else in the app ever calls Resend's SDK directly, so a future provider swap touches one implementation, not every call site.
- **Sending domain, owner-approved:** a dedicated sending subdomain, `notify.stonecolumn.com`, rather than the root domain — standard practice that keeps the root domain's reputation isolated from bulk/transactional mail delivery issues (bounces, spam-complaint rates) that are common even with legitimate providers. Reply-to (Section 6 of the prior turn's decisions) still resolves to a real monitored Stone Column inbox on the root domain — the subdomain is for sending only.

**Part E — bid package correspondence, with the portal as the system of record and real inbound-email routing.**

**Owner-approved architecture, reversing this document's earlier "portal-only" recommendation.** The portal thread (`entity_messages`, below) is the authoritative record of every conversation regardless of which channel a message arrived through — an inbound email reply becomes a real row in the same thread a portal-only message would, so staff and any future report always sees one complete, chronological conversation, never two disconnected ones.

- **`entity_messages`** (new): `id`, `entity_type` (`bid_package`/`material_order`, extensible later), `entity_id`, `author_profile_id` (nullable when the author is a vendor without a portal profile — see below), `vendor_id` (nullable — set when this is a private one-to-one thread with a specific vendor, or when a vendor authored it), `source` (`portal`/`inbound_email`, so staff can always see how a given message actually arrived), `body`, `visible_to_all_vendors boolean` (default `true`, mirroring `bid_questions`' already-proven default), `internal_only boolean`, `created_at`. Attachments reuse `bid_package_documents`/a parallel `entity_message_attachments` join, not a new file-storage mechanism.
- RLS for portal-authored reads/writes reuses the exact pattern already proven correct for `bid_questions` (`visible_to_all_vendors OR (vendor_id is not null AND is_vendor_member(vendor_id))`) — the isolation logic only needs to be gotten right once, and it is a directly re-verified pattern (Section 15), not a new one being trusted for the first time. Inbound-email-sourced rows are inserted by a trusted server-side process after the verification steps below, never by a vendor's own RLS-scoped session, so the same isolation guarantee holds for both channels.
- **Package/vendor-specific inbound reply routing.** Every vendor+package pairing gets one dedicated, opaque reply address at invite time — a new **`inbound_reply_tokens`** table (`id`, `entity_type`, `entity_id`, `vendor_id`, `token` (unique, unguessable, never the raw record id), `created_at`, `revoked_at`). Every outbound notification for that thread (an invitation, a staff message, an addendum) sets this token's address (`reply+<token>@notify.stonecolumn.com`) as the Reply-To header — a vendor who hits "reply" in their normal email client sends to an address that already identifies exactly which vendor and which package the reply belongs to, before any content is even read.
- **Inbound processing, in order, nothing trusted until verified:**
  1. **Token resolution** — the reply token must resolve to a real, non-revoked `inbound_reply_tokens` row. No match → quarantine (`unmatched_token`), never silently dropped.
  2. **Sender verification** — the email's FROM address must exactly match (case-insensitive) the vendor contact's known, on-file email for that specific vendor. A right-token-wrong-sender email (a forward, a spoofing attempt, or simply a vendor emailing from a personal address instead of their registered one) does not enter the thread automatically. No match → quarantine (`sender_mismatch`).
  3. **Authenticity verification** — the inbound-processing provider's own SPF/DKIM/DMARC pass/fail signal must be positive before anything else runs. Fail → quarantine (`auth_failed`).
  4. **Attachment safety** — a size/type allowlist plus malware/virus scanning (via the storage layer or a dedicated scanning API — a real integration to select at implementation time, not built from primitives) before any attachment is stored. Unsafe → quarantine (`unsafe_attachment`), the rest of the message may still proceed without the unsafe attachment, at implementation's discretion.
  5. **Duplicate prevention** — the provider's own message-id (or, absent one, a hash of normalized sender+body+timestamp-bucket) is checked against previously processed inbound messages before insert; a redelivered webhook (providers do this) is a no-op, not a duplicate thread entry.
- **Only after all five checks pass** does the message become a real `entity_messages` row with `source='inbound_email'`, correctly attributed to the resolved vendor, visible in exactly the thread(s) that vendor is entitled to see and nowhere else — the same double-gate isolation (`is_project_vendor()` + the specific invitation record) that already governs every other vendor-visible row in this codebase applies identically here, since the resolved `vendor_id`/`entity_id` pairing is checked against it before display.
- **Quarantine, not silent drop, for anything that fails.** New **`quarantined_inbound_messages`** table (`id`, `received_at`, `raw_payload jsonb`, `reason` (`unmatched_token`/`sender_mismatch`/`auth_failed`/`unsafe_attachment`/`duplicate`), `reviewed_by`, `reviewed_at`, `resolution` (`promoted`/`discarded`), `promoted_message_id`) — a staff-visible review queue, never exposed to any vendor or portal thread. Staff can manually promote a quarantined message into the real thread after human review (e.g., confirming a vendor really did email from a new address), or discard it.
- **Isolation guarantee, restated precisely:** a reply token is scoped to exactly one vendor+package pair; even a guessed or leaked token cannot resolve into another vendor's thread, because resolution additionally requires the FROM address to match that specific vendor's own on-file email — two independent facts must agree, not one.
- **Honest operational tradeoff, preserved from the original analysis and still true even though inbound routing is now being built:** a legitimate vendor reply will predictably land in quarantine sometimes — most commonly, a vendor emailing from a personal or different-employee address than the one on file. This is expected, normal behavior, not a bug, and it means staff need a light, ongoing habit of checking the quarantine queue, not a one-time setup. This is the real cost of building the harder, more capable path the owner has chosen over the simpler portal-only alternative — worth stating plainly rather than glossing over now that the harder path is approved.
- **Provider capability check, flagged for implementation time, not assumed here:** Resend's own inbound-email support should be confirmed against its current feature set before implementation begins; if it lacks mature inbound parsing, a hybrid (Resend for outbound, a provider with strong inbound parsing — e.g., Postmark's Inbound — for just the reply leg) is a normal, supported pattern and should be treated as an acceptable outcome, not a design failure, since the `EmailService`/inbound-webhook boundary already isolates this choice from the rest of the app.

### P5.3 — Material Order Collaboration & Documents

**Answers owner item #7.**

- **Owner-approved, with a structural (not checkbox-based) safety default.** Vendor correspondence on a material order is allowed, scoped to the vendor actually on that order — but "Internal Activity" and "Vendor Conversation" are **two entirely separate screen surfaces (tabs), not one shared thread with a per-message visibility toggle.** The owner explicitly rejected an easy-to-misuse checkbox design; the reason a checkbox is unsafe is that the default state of a shared composer is one accidental click away from leaking an internal note to a vendor, whereas two separate composers mean a staff member has to deliberately navigate to the vendor-facing tab before they can write anything a vendor will ever see. Both tabs still write to the same underlying `entity_messages` table (`entity_type='material_order'`, optionally scoped to one line item via a nullable `line_item_id` column) — the safety comes from the UI never exposing a single shared entry point, not from re-deriving the isolation logic twice. The Internal Activity tab has no vendor-visibility control at all (every row it creates is `internal_only=true`, non-editable); the Vendor Conversation tab only exists/is enabled once a vendor is actually associated with that order, and every row it creates is `internal_only=false` by construction — there is no field in either composer where a user could change this value.
- **System activity timeline needs no new table.** "Created," "committed," "PO issued," "received," "backordered" are already real, permanent rows in `audit_log` today, via the standard trigger every one of these tables already has — this package's only job here is a read-only query surfacing those rows chronologically on the order/line-item screen (inside the Internal Activity tab, alongside staff comments), not a new logging mechanism.
- **Vendor-visible correspondence on material orders is new RLS surface**, not an extension of an existing one — `material_orders` today has explicitly no vendor policy at all ("procurement is internal only," by design, confirmed directly in the current schema comment). Enabling vendor correspondence on a specific order requires the same kind of explicit, per-record invitation grant P5.2 already establishes for bids (a vendor is only ever granted visibility into the one order they're party to, never all of a project's procurement) — this is a real, deliberate widening of scope beyond P5's original "procurement is internal only" design. The owner has now explicitly approved this widening (Section 9); it remains noted here because it is a real security-boundary change worth every future reader of this document understanding was deliberate, not incidental.
- **`material_order_documents`** (new): same shape as `bid_package_documents`, with an added `document_type` enum (`vendor_quote`/`purchase_order`/`invoice`/`packing_slip`/`delivery_ticket`/`revised_confirmation`/`product_info`/`photo`) and an optional `line_item_id`. An **invoice row gets first-class linkage** — `cost_code_id`, `vendor_id`, `material_order_id` are real columns, not inferred from context, and a nullable `expense_id` sits ready for P4.4 to populate once QuickBooks reconciliation exists, rather than treating an invoice as an unclassified generic attachment.
- Line-item extensions (small, direct columns, no new tables): `expected_delivery_date`, `backorder_reason text`, `backorder_expected_date`, `damaged_quantity`, `returned_quantity`.
- Per-cost-code totals, PO-vs-invoice variance, and search/filter by vendor/status/cost code/delivery date are all queries over data this design already produces — no additional schema.

### P5.4 — Financial Traceability, Cross-Navigation & Project-Context Clarity

**Answers owner item #6 and closes the two findings from Section 3. Also completes P5's own outstanding Task 11.**

- **Real cross-navigation, both directions.** Commitments rows get a real link to their source bid submission or material order detail page. Awarded-bid and committed-order screens get a real deep link to the *specific* resulting commitment row(s) (e.g., `/admin/commitments?highlight=<id>`), not just the generic list page they link to today.
- **`BudgetTable.tsx` gains Committed and Projected columns per cost code** — the financial engine already computes both; this is a rendering change, not a math change. No change to the underlying calculation, preserving the existing append-only ledger/integer-cents/idempotency guarantees untouched.
- **Awarding a bid or committing an order never touches `budget_ledger`.** This is already true today (confirmed directly from `award_bid()`/`commit_material_order()`'s own SQL, and independently re-confirmed — Section 15) — this package's job is making that fact visible and unambiguous on screen (a committed amount is clearly labeled as committed, distinct from the approved/revised budget line it sits against), not changing the underlying behavior, which already correctly keeps these separate.
- **Project-context clarity fix, scoped narrowly to the three P5 screens** (Bids, Commitments, Procurement) that this incident actually touched — not a nav redesign, per the owner's explicit instruction to defer that to P9.5 (see Section 8). A more prominent, unmistakable "you are viewing `<project>`" treatment on these three screens specifically, plus a safeguard against silently rendering a financial-data screen against an unexpected project when no selection cookie is present (prompt for explicit selection rather than defaulting to alphabetically-first).
- **Folds in P5's own Task 11**: `getOverdueBidPackages()`/`getBackorderedMaterialLineItems()` (already fully specified in the original P5 plan, never implemented) — same "surface what needs attention, with a real link to it" theme as everything else in this package.

---

## 6. Reducing duplicate entry (owner item #9)

`PRODUCT-COMPLETENESS-MATRIX.md` Section D already carries the row this requirement traces back to — recorded during the P5 Tasks 7–9 owner preview, naming six specific efficiency capabilities. Reconciled against P5.1–P5.4 one by one, so nothing is silently dropped or silently duplicated:

1. **Awarded-bid → order conversion.** Not attempted by any of P5.1–P5.4. Remains genuinely unhomed — `bid_award` and `material_order` stay two intentionally separate `committed_costs` paths, unchanged by this design. Defer, per the matrix's own "do not build speculatively" instruction, until real usage of P5.1–P5.4 shows whether this conversion is actually wanted.
2. **Order duplication / recurring orders.** Not attempted. A cheap, small addition to P5.3 if the owner wants it pulled in ("start a new order from this one's line items"), but not included by default — flagged here as an easy add-on, not a silent scope creep.
3. **Order line-item CSV import.** Not attempted. Genuinely unhomed, unchanged.
4. **Estimate-line → order/bid creation.** Not attempted. Genuinely unhomed, unchanged.
5. **Supplier quote/document conversion** ("turn an uploaded vendor quote into structured order data"). P5.2 and P5.3 make uploading a vendor quote *possible* for the first time (as a typed `material_order_documents` row), but neither package does anything with the uploaded file's contents beyond storing and categorizing it — no extraction, no auto-populated line items. The document-extraction/OCR capability itself remains explicitly deferred (see Section 7) — this design only builds the storage half a future extraction feature would eventually write into.
6. **Reusable per-vendor item catalogs.** Not attempted in v1, deliberately — the owner's own instruction for P5.1 is "keep initial vendor creation simple." A `vendor_items` catalog is a natural, explicitly-flagged future extension of P5.1's vendor record once the directory itself is in real use, not part of this proposal.

Net: P5.1–P5.4 build real infrastructure two of the six items (5 and, partially, 1's prerequisite data model) will eventually need, but implement none of the six conversion/automation behaviors themselves. This matches the owner's explicit "do not implement all of these... establish dependencies and exact roadmap placement" instruction — placement is confirmed above, nothing new is built.

---

## 7. Future AI readiness (owner item #10)

Per `AI-ASSISTANT-ARCHITECTURE.md` (confirmed, re-read directly): the future assistant is not a new trust boundary — it calls the same repository(reads)/service(writes) functions the UI already calls, under the asking user's own session, with no service-role shortcut ever. Every new table and write path in P5.1–P5.4 follows this by construction, not as an afterthought:

- Every new write (`vendor_contacts`, `vendor_documents`, `bid_package_documents`, `bid_invitation_emails`, `entity_messages`, `material_order_documents`, the new `bid_packages`/line-item columns) goes through a named service function, callable identically by a Server Action today and a future AI tool-adapter later — never inline logic in a route or component.
- Every new read goes through a named repository function (e.g., a future `VendorRepository`, extending `entity_messages`/`material_order_documents` reads alongside the existing `FinancialRepository` pattern), RLS-scoped exactly as today — a vendor-role AI query would see exactly what that vendor's own RLS already permits, nothing more, with no special-casing.
- Structured relationships, stable UUIDs, authorship (`created_by`/`author_profile_id`), timestamps, and visibility flags (`internal_only`, `visible_to_all_vendors`) are present on every new table by design — the exact shape `AI-ASSISTANT-ARCHITECTURE.md` names as prerequisites for a future assistant to answer questions like "what bids are outstanding" or "what's backordered" correctly and safely, without exposing a competing vendor's bid or an internal note.
- Status history for anything new is already covered by the existing `audit_log` mechanism (Section 5, P5.3) — no separate "history" table is invented, matching the existing pattern exactly.
- `ai_interaction_log` and `audit_log.initiated_via` remain explicitly out of scope — `AI-ASSISTANT-ARCHITECTURE.md` itself defers both to P15's own future design, and nothing in P5.1–P5.4 needs them built now.

**Nothing AI-shaped is built by this design** — no assistant code, no AI-specific table, no new permission model. This section exists only to confirm the shape of what *is* built won't need a rewrite later.

---

## 8. Navigation (owner item #11)

**No change proposed.** The owner's own message confirms the current Organization/Current-Project grouping is sufficient to continue development, and none of P5.1–P5.4 introduces a workflow confusing enough to justify reopening it early. P5.4's "you are viewing `<project>`" clarity fix (Section 5) is a targeted change to three existing screens' own content, not a navigation or information-architecture change — the sidebar, its grouping, and its iconography are untouched by every package in this document. The full visual/navigation refinement stays where the owner already placed it: P9.5, after P5–P9's operational workflows exist.

---

## 9. Consequential owner decisions — final, recorded 2026-09-04

All six decisions below are **approved and final**, not open questions. Each is recorded with its decision, the reasoning behind it, and the concrete design commitment it produces elsewhere in this document.

1. **Email provider — decided: Resend, behind a replaceable internal `EmailService` interface.** No app code ever calls the Resend SDK directly; every send goes through one internal interface, matching the `StorageAdapter` pattern this codebase already uses for exactly this kind of provider-swap protection. Design commitment: Section 5, P5.2 Part D.
2. **Sending domain — decided: a dedicated sending subdomain, `notify.stonecolumn.com`, not the root domain.** Isolates the root domain's reputation from transactional/bulk mail delivery issues. Reply-to still resolves to a real, monitored root-domain inbox. Requires the owner to add DNS records (SPF/DKIM) for the subdomain — an action outside this codebase. Design commitment: Section 5, P5.2 Part D.
3. **Bid correspondence channel — decided: the portal is the system of record, with real, verified inbound-email reply routing, not a portal-only design.** This reverses the original recommendation in this document's first draft. The owner weighed the added engineering/security surface (package-specific reply tokens, sender verification, authenticity checks, attachment scanning, duplicate prevention, a quarantine queue for anything that fails) against the convenience of vendors being able to just hit reply, and chose to build the fuller capability now rather than defer it. Design commitment: Section 5, P5.2 Part E (fully redesigned around this decision) — including the honest operational cost this choice carries: legitimate replies from an unregistered vendor address will predictably land in quarantine and need light, ongoing staff triage, not a one-time setup.
4. **W-9 documents — decided: materially stricter than COI/license, not the same policy for all vendor documents.** Access restricted to an authorized admin/accounting role (a narrower group than all org staff), private storage with expiring signed download links, every access (not just every write) individually audited, and explicit, standing exclusion from any future OCR/search/AI indexing. COI/license stay on the ordinary staff-wide vendor-document policy, since they're routinely needed by staff outside accounting. Design commitment: Section 5, P5.1.
5. **Vendor correspondence on material orders — decided: allowed, with a structural safety default, not a checkbox.** "Internal Activity" and "Vendor Conversation" are two separate screen surfaces with no shared entry point, so exposing something to a vendor requires deliberately navigating to the vendor-facing tab, never an easy-to-miss checkbox on a shared composer. Design commitment: Section 5, P5.3.
6. **Sequencing — decided: P5.0 first, then P5's own Task 11/12 closeout, then an owner checkpoint, then P5.1 → P5.2 → P5.3 → P5.4.** Recorded in full in Section 4.

---

## 10. Screen-level workflows (admin and vendor)

**Admin — vendor directory (P5.1):** Vendors list (search/filter by trade, active status, compliance-expiring-soon) → Create (name/email/phone only) → Detail screen with sectioned tabs (Contacts, Compliance & Licensing, Payment Terms, Notes, History) → each section independently editable, no giant single form.

**Admin — bid package (P5.2):** existing create/publish/invite flow, extended with a Documents section (upload once, select which to include, mark internal-only) and a Correspondence section (broadcast message, or a private thread per vendor) alongside the existing Q&A. Invite now shows real send/delivery/open/response status per vendor instead of just an "invited" badge.

**Vendor — bidding (P5.2, new):** email → click secure link → land authenticated in *that specific package*, nothing else → scope, documents (permitted only), Q&A, addenda (with required acknowledgment for material ones) → submit (base price, breakdown, alternates, exclusions, qualifications) → confirmation → can revise before deadline if allowed → never sees another vendor's anything. This is the one genuinely new surface area in this whole design (no prior vendor-facing screen exists to extend), so its own implementation plan will need to walk through account creation (magic-link first access vs. an existing `vendor_members` profile logging back in), session scoping (confirmed technically sound via the existing double-gate RLS pattern, Section 5 Part C), and empty/error states (expired invitation, revoked access, deadline passed) explicitly — flagged here so that plan doesn't treat "vendor UI" as a single undifferentiated task.

**Admin — material order (P5.3):** existing lifecycle unchanged, extended with a Documents tab (typed uploads) and a Comments/Activity tab (chronological, internal vs. vendor-visible clearly separated, system events interleaved).

**Admin — Commitments/Bids/Financials (P5.4):** existing screens, extended with real cross-navigation links and, on Financials, per-cost-code Committed/Projected columns.

---

## 11. Database/security implications

Every new table follows this codebase's existing, established convention exactly (confirmed by direct research and independently re-verified — Section 15): `is_org_staff_for_org()`/`is_financial_staff(project_id)`-scoped RLS for staff; a real, tested double-gate (project-level vendor membership AND record-specific invitation) for any vendor visibility, never a blanket grant; the appropriate audit trigger (`log_audit_no_project()` for org-scoped tables, `log_audit()` for project-scoped ones); `reject_delete()` + `revoke delete` for anything that must persist as a permanent record (documents, messages, invitation history) — archive/supersede, never delete, matching every existing table in this domain. Every vendor-isolation policy gets the same explicit "Vendor A sees nothing belonging to Vendor B" test this codebase already requires of every vendor policy since P3.

No existing table's RLS is weakened by any of this. The one deliberate widening (material-order vendor correspondence, P5.3) is called out explicitly in Section 9 for owner sign-off precisely because it is a real boundary change.

---

## 12. Migration and compatibility considerations

All four packages are additive: new tables, new nullable columns on existing tables, one new versioning pair on the existing `documents` table (`version`/`superseded_by_id`, both nullable-safe defaults, confirmed to collide with nothing already there). Nothing in P5 Tasks 1–10's shipped behavior needs to change for any of this to work — existing bid packages, material orders, and commitments continue to function exactly as they do today; the new capability layers on top. No backfill is required for existing rows (new columns default to sensible empty/nullable values; existing `documents` rows simply start at `version=1` with no prior version). The one place existing behavior is *extended* rather than purely added-to is `vendors.contact_name`/`email`/`phone`, which becomes a kept-in-sync mirror of `vendor_contacts`' primary row rather than the sole source of truth — every existing reader of those columns keeps working unchanged.

---

## 13. Acceptance criteria and verification strategy (per package)

Each package, once approved, gets its own full acceptance-criteria list and verification plan in its own dedicated design document (matching this repo's `P4.1-DESIGN.md`-style convention) at implementation time — not written in full here, since acceptance criteria this precise are implementation-planning work, not this document's job. At minimum, every package's plan will require: typecheck/test/build green, an independent adversarial review pass, live verification against real hosted-dev data (never fabricated), explicit cross-vendor/cross-project isolation tests, and — for anything vendor-facing — a real end-to-end run of the vendor-side flow, not just the admin side.

---

## 14. Estimated implementation time by package

Rough, package-level estimates, in the same "task count" terms P5 itself was scoped in (P5 shipped 10 real tasks for its core scope, with 2 more outstanding):

| Package | Rough size | Basis |
|---|---|---|
| P5.4 | ~2–3 tasks | No new tables; UI/query changes only |
| P5.1 | ~4–5 tasks | 3 new tables, one admin screen with sectioned sub-forms, history view |
| P5.2 | ~8–10 tasks | Largest: RLS fix, document versioning, upload route, invitation infrastructure (new provider integration), vendor-facing UI (genuinely new surface area — see Section 10's flag), correspondence table + RLS |
| P5.3 | ~4–5 tasks | Reuses P5.2's document/message infrastructure; mostly new columns + one new table + UI |

These are sizing estimates for sequencing conversation, not committed schedule — real per-task estimates come from each package's own implementation plan once approved.

---

## 15. Independent-review findings and resulting revisions

An independent review ran against this document's first draft, checking every cited fact against the real codebase (including two live hosted-dev queries, re-run independently of the original research) and checking the document's coverage against the owner's original 11 requirement areas and 12-item required-output list.

**Verdict: no factual errors found.** Every file:line citation, schema claim, and live-data claim (including the two near-duplicate "CDP Smoke Test" project names and the stray $2,025,000,000 test row) was independently re-verified as accurate.

**Two completeness gaps required revision, both fixed in this version:**
1. Owner items #9 (reducing duplicate entry) and #10 (AI-readiness) were entirely absent from the first draft despite the document's own header claiming to address all 12 required-output items. **Fixed:** added as Sections 6 and 7 respectively, reconciling the six specific efficiency items from `PRODUCT-COMPLETENESS-MATRIX.md` one by one, and confirming every new table/service in this design follows `AI-ASSISTANT-ARCHITECTURE.md`'s repository/service pattern.
2. Section 4's P11 reconciliation silently dropped `vendor_compliance` from P11's originally-named six tables without saying where its scope went. **Fixed:** Section 4 now states explicitly that `vendor_compliance` is fully absorbed by P5.1's `vendor_documents` table, and P5.1's own section repeats this.

**Two minor bookkeeping issues, also fixed:**
- P5.2's section header omitted owner item #4 (bid correspondence) despite Part E of that same section directly answering it — corrected.
- Owner item #11 (navigation) previously only appeared in a parenthetical — now has its own explicit section (Section 8).

**Two notes, addressed with small clarifying language rather than a structural change:**
- The relationship between the new `vendor_contacts` table and `vendors`' existing `contact_name`/`email`/`phone` columns was left unstated in the first draft — Section 5 (P5.1) and Section 12 now explicitly describe the legacy columns as a kept-in-sync mirror of the primary contact, so no existing reader breaks.
- The first draft's description of `vendor_contacts` as modeled on an "already designed" precedent could be misread as pointing at working code — reworded to make clear `project_decision_makers` is itself an unimplemented design record, not a table to extend.

No finding required reconsidering the package boundaries, the schema sketches, the RLS approach, or the traceability root-cause conclusion — all of those held up under independent re-verification exactly as originally proposed.

**Postscript, 2026-09-04:** after this review, the owner made six final decisions (Section 9) that materially revised several designs beyond what independent review alone had touched — most substantially, Part E of P5.2 (bid correspondence) now specifies real, verified inbound-email routing in place of the portal-only approach this document originally recommended, W-9 handling (P5.1) is now materially stricter than other vendor documents, material-order vendor correspondence (P5.3) now uses structurally separate surfaces rather than a shared-thread checkbox, and sequencing (Section 4) now extracts project-context safety as its own first package, P5.0, ahead of everything else including P5's own outstanding tasks. These are owner policy decisions, not corrections to an error the review found — the document above reflects the decided state, not a proposal awaiting further review.
