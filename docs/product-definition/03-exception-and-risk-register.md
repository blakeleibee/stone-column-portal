# Exception & Risk Register

For each scenario: **Intended record status**, **Approval
requirements**, **Reversal method**, **Notification behavior**,
**Audit history**. Where a scenario touches something already built
(Package 1's financial engine/schema), that's noted explicitly —
everything else describes intended behavior for a module that doesn't
exist yet.

---

### 1. Duplicate or recoded invoices
- **Record status**: the second (duplicate) import row is flagged
  `unmatched`/`duplicate` during import review, never silently
  auto-merged — this exact behavior is already built and tested in
  Package 1's import-batch design (schema only; the import wizard UI
  itself is still missing).
- **Approval**: Accounting must explicitly resolve each duplicate
  (accept as a real second charge, or exclude) before the batch is
  confirmed.
- **Reversal**: if a duplicate is posted before being caught, the fix
  is a void + corrected re-entry (already enforced by the expense
  state machine — a posted expense's financial fields are frozen;
  voiding and re-entering is the only path).
- **Notification**: none required beyond the normal import review
  screen.
- **Audit**: both the original and the correction remain visible,
  linked via `corrects_expense_id` (already in schema).

### 2. Credits received after billing
- **Record status**: modeled as a new expense with a negative amount
  (already supported — the engine's own test suite proves refunds/
  credits work this way) or, if the original draw is already issued, a
  credit against a future draw rather than editing the past one.
- **Approval**: Accounting applies; Owner reviews if it affects a
  client-facing balance.
- **Reversal**: never edit the original billed amount; the credit is
  its own new, signed record.
- **Notification**: Client sees the credit on their next draw/
  statement.
- **Audit**: full ledger history preserved (already the case for
  everything in `budget_ledger`/`expenses`).

### 3. Partial client payment
- **Record status**: `invoices.status = 'partially_paid'` (a value
  already reserved in the Feature Register's proposed enum for module
  6); the unpaid remainder stays as the open balance.
- **Approval**: none required — this is a normal, expected state.
- **Reversal**: not applicable; payments only ever add, never edit
  the invoice's frozen total.
- **Notification**: Client sees updated balance; Accounting sees the
  payment recorded against the draw.
- **Audit**: every payment record kept individually, never netted into
  a single "amount paid" field that loses the payment history.

### 4. Correcting a finalized draw
- **Record status**: the original issued draw is never edited — its
  calculation is permanently frozen (explicit master-plan requirement).
  A correction is a new draw (a credit memo or an adjustment draw) that
  references the original.
- **Approval**: Owner/Accounting sign-off required, same as issuing any
  draw.
- **Reversal**: the "reversal" *is* the new linked draw — there is no
  in-place reversal of the original.
- **Notification**: Client sees both the original and the correcting
  draw, with a clear link between them.
- **Audit**: this is the single scenario module 6 most needs to get
  right on day one, since it's the highest-stakes "don't silently
  overwrite financial history" case in the whole platform, on par with
  what Package 1 already solved for the budget ledger.

### 5. Unsigned work authorized in an emergency
- **Record status**: recorded immediately as a `field_directives`
  entry (module 7) — the master plan's lightweight path for exactly
  this — not left undocumented until a formal change order can be
  written.
- **Approval**: verbal/emergency authorization by PM is sufficient to
  create the record; formal client sign-off follows within a defined
  window (e.g., 48–72 hours) to convert it into a real Change Order.
- **Reversal**: not applicable (this is a forward-only escalation path,
  field directive → change order, never the reverse).
- **Notification**: Client/Decision-maker notified immediately that
  emergency work was authorized, with the pending formal change order
  to follow.
- **Audit**: the field directive's original content carries forward
  into the change order without retyping (explicit master-plan
  requirement) — the link between the two must be preserved.

### 6. Allowance credits and overages
- **Record status**: both directions are first-class, not just
  "over budget" — a selection can land under its allowance (a credit)
  or over it (an overage), and both need to show clearly, not be
  buried in a single variance number.
- **Approval**: overages typically need Client/Decision-maker
  acknowledgment before purchasing proceeds (same "review before
  approval" principle as selections generally); credits usually don't
  need approval to apply, but should still be visible.
- **Reversal**: if a selection changes after purchase, that's a new
  version requiring re-approval, not an edit to the old one.
- **Notification**: Client sees the allowance-vs-actual comparison on
  the selection itself.
- **Audit**: full selection version history (module 8).

### 7. Client-supplied materials
- **Record status**: the selection is recorded with no vendor cost
  (owner-direct purchase) but the allowance is still tracked against
  it, so the budget comparison remains meaningful even with $0 actual
  cost from Stone Column's side. The financial engine already supports
  this exact case via `feeEligibleOverride` on an expense (an owner-
  direct purchase is explicitly excluded from the fee basis even
  though it flows through an otherwise fee-eligible cost code) —
  proven and tested in Package 1.
- **Approval**: PM confirms the item was client-supplied; no purchase
  approval needed since Stone Column isn't buying it.
- **Reversal**: not applicable.
- **Notification**: none required beyond normal selection status.
- **Audit**: the selection record notes "client-supplied," distinct
  from a $0 allowance.

### 8. Vendor abandonment
- **Record status**: the vendor's open `committed_costs` rows are
  marked `cancelled` (a real, tested status transition already in the
  schema); a replacement vendor's commitment is a new row, not a
  reassignment of the old one.
- **Approval**: PM/Owner decision to terminate and re-source.
- **Reversal**: not applicable — cancellation is one-way (terminal
  states never revert, already enforced by the committed-cost status
  trigger).
- **Notification**: any pending selections/schedule items tied to that
  vendor should surface in the Action Center for reassignment.
- **Audit**: the cancelled commitment remains visible with its full
  history; nothing is deleted.

### 9. Expired insurance during active work
- **Record status**: the vendor's compliance record (module 12/17)
  flips to `expired`; this should **block new commitments** to that
  vendor going forward, but not retroactively invalidate work already
  committed/paid.
- **Approval**: none — this is a system-detected state, not a human
  decision, though Owner should be notified to decide whether to pause
  the vendor's active work.
- **Reversal**: resolves automatically once a renewed COI is on file.
- **Notification**: proactive surfacing in the Action Center *before*
  expiration (e.g., 30 days out), not just after the fact.
- **Audit**: compliance status history retained (renewal dates, gaps).

### 10. Failed inspections
- **Record status**: `inspections.result = 'failed'`; the related
  schedule phase and any pending draw/lender-draw that depends on it
  are blocked, not silently allowed to proceed.
- **Approval**: re-inspection required; PM schedules it.
- **Reversal**: not applicable — a failed inspection is a permanent
  historical record; a subsequent passed re-inspection is a *new*
  record, not an edit to the failed one.
- **Notification**: Field/PM immediately; Client typically sees status
  only ("inspection pending re-schedule"), not the raw failure reason.
- **Audit**: full inspection history, pass and fail, retained.

### 11. Outdated plan use in the field
- **Record status**: documents are versioned (module 10); the
  publish-state pattern already proven for expenses (internal → ready
  → published) extends naturally — an outdated version should be
  clearly marked superseded, not deleted, so "which version did the
  crew actually use" stays answerable after the fact.
- **Approval**: PM/Architect controls which version is "current."
- **Reversal**: not applicable — old versions stay visible, just
  marked superseded.
- **Notification**: field staff should see a clear "newer version
  available" indicator, not just silently get the latest without
  knowing a change happened.
- **Audit**: full version history per document.

### 12. Multiple client decision-makers who disagree
- **Record status**: the system doesn't automatically resolve
  disagreement — the platform's job is to surface both positions
  clearly (e.g., on a selection or change order, show which
  decision-maker responded and how). **Resolved** (previously an open
  product decision): the approval rule — any-one, primary-binding, or
  unanimous — is a per-project, per-record-type configuration, not a
  single fixed platform behavior. Full model:
  `docs/production-build/CLIENT-APPROVAL-MODEL.md`. Schema
  (`project_decision_makers` and the rule-storage columns) remains
  P2/P7/P8 implementation scope.
- **Approval**: per above — the rule model is settled; P7/P8 implement
  it against `CLIENT-APPROVAL-MODEL.md`.
- **Reversal**: not applicable.
- **Notification**: all decision-makers see all responses on a shared
  item, not siloed views.
- **Audit**: every decision-maker's individual response recorded
  separately, never merged into a single "client approved" flag that
  loses who actually said what.

### 13. Project pauses, cancellations, or contract-type changes
- **Record status**: `projects.status` already has `on_hold` and
  `archived` values reserved in the enum (unused today); a
  contract-type change (e.g., cost-plus to fixed-price mid-project) is
  a new `project_fee_rules` row with a new `effective_from` date — the
  existing versioned-fee-rule design already supports this without
  modification, it just needs UI.
- **Approval**: Owner sign-off for pause/cancellation; both parties
  (contract amendment) for a contract-type change.
- **Reversal**: resuming a paused project doesn't need reversal — it's
  a forward status change back to `active`.
- **Notification**: Client and any assigned vendors notified of a
  pause/cancellation given the direct impact on their own scheduling.
- **Audit**: `projects` status history and `project_fee_rules`
  versioning already both support this at the schema level.

### 14. Confidential internal files accidentally exposed
- **Record status**: the publication-status pattern (internal/ready/
  published/withdrawn) already prevents most accidental exposure by
  design — nothing becomes client-visible without an explicit publish
  action. The residual risk is a *human* publishing the wrong file, not
  a system default failure.
- **Approval**: publishing to a client should require a deliberate,
  reviewable action (matching the master plan's "no unreviewed single
  click" principle already applied to selections/change orders) — this
  should extend to document publishing too, not just financial/
  selection approvals.
- **Reversal**: withdrawing a published document should be immediate
  and should log exactly when it was exposed and for how long — this
  is a security-incident-adjacent scenario, not just an "undo," and
  deserves its own audit trail entry distinct from ordinary publish/
  unpublish toggling.
- **Notification**: Owner should be alerted when a document is
  withdrawn shortly after publishing (a signal something may have gone
  wrong), not just silently accept the withdrawal.
- **Audit**: full publish/withdraw history with timestamps and actor,
  building on the same trigger-based audit logging already proven for
  the financial schema.

### 15. Changes to builder-fee percentages
- **Record status**: `project_fee_rules` is already versioned
  (`effective_from`/`effective_to`) specifically so a fee change never
  retroactively alters already-issued invoices — Package 1 explicitly
  built this in and the master plan calls it out directly ("later
  changes to project fee settings must not alter past invoices").
- **Approval**: Owner sign-off, since this affects company revenue.
- **Reversal**: not applicable — a new fee-rule version is forward-
  only; the old one remains for historical calculation.
- **Notification**: Client should be notified of a fee-structure change
  if their contract allows it to change (contract-dependent, not
  universal).
- **Audit**: already fully supported by the existing schema design.

### 16. Investors entering or leaving a project
- **Record status**: covered in Workflow Map §12b — access starts/
  stops cleanly at the `investor_project_stakes` record's own
  effective dates, without retroactively hiding history the investor
  was entitled to see while active.
- **Approval**: Owner grants/revokes.
- **Reversal**: not applicable — an investor's stake record has its
  own start/end, not an edit to history.
- **Notification**: the investor should receive a clear notice of
  their access starting/ending.
- **Audit**: access grants and revocations logged given financial
  sensitivity.

### 17. Warranty claims after a subcontractor is unavailable
- **Record status**: the warranty claim is recorded regardless of
  whether the original vendor can be reached; it needs a fallback
  assignment path (a different vendor, or Stone Column's own field
  staff) rather than being stuck unassigned.
- **Approval**: PM decides the fallback assignment.
- **Reversal**: not applicable.
- **Notification**: Client sees the claim's status (assigned/in
  progress/resolved) regardless of the reassignment happening behind
  the scenes.
- **Audit**: the original vendor assignment and the fallback
  reassignment both remain visible — don't silently overwrite who was
  originally responsible.

---

## Additional scenarios (added per explicit correction — expanded register)

### 18. Vendor invoice exceeding its commitment
- **Record status**: the excess amount does not silently inflate the
  commitment — it's flagged for review before posting, same principle
  as any variance the engine's suggestion system already surfaces for
  budget-vs-actual.
- **Approval**: PM/Accounting must explicitly approve the overage
  (either as a valid scope addition needing its own change order, or a
  billing error to correct with the vendor) before the expense posts.
- **Reversal**: not applicable until posted; once posted, standard
  void-and-correct.
- **Notification**: PM alerted at import/entry time, not discovered
  later during reconciliation.
- **Audit**: the original commitment amount and the excess are both
  visible, never merged into one adjusted number.

### 19. Split costs across projects or cost codes
- **Record status**: a single vendor invoice covering multiple
  projects/cost codes is recorded as multiple linked expense rows (one
  per project/cost code), each carrying a reference back to the same
  source invoice — never one row awkwardly assigned to a single
  project when it actually spans several.
- **Approval**: Accounting determines the split at entry/import time.
- **Reversal**: correcting a wrong split is void-and-correct on the
  specific misallocated row(s), not the whole invoice.
- **Notification**: none required beyond normal review.
- **Audit**: all split rows carry the same source reference so the
  original invoice is always reconstructable.

### 20. Sales tax and tax-exempt purchases
- **Record status**: tax amount tracked as its own field, distinct from
  material/labor cost, so fee-eligibility rules (already proven for
  owner-direct purchases via `feeEligibleOverride`) can apply correctly
  — tax treatment is itself configurable per project per the master
  plan's original fee-rule design (`tax_treatment` field already exists
  in `project_fee_rules`).
- **Approval**: none beyond normal expense entry.
- **Reversal**: standard void-and-correct if entered wrong.
- **Notification**: none required.
- **Audit**: tax amount always separately visible in any transaction
  drill-down, never buried inside a combined total.

### 21. Retainage release
- **Record status**: a distinct payment-ledger event (module 22),
  released either partially (at substantial completion) or fully (at
  final closeout) — never achieved by editing the original draw's
  retainage figure.
- **Approval**: Owner/Accounting approves release, often gated on
  closeout (Workflow Map §12a) or a lien-waiver being on file (module
  12) first.
- **Reversal**: not applicable — a release is a forward-only event.
- **Notification**: Client sees the retainage balance decrease with a
  clear "released" record, not just a number changing silently.
- **Audit**: full retainage history — withheld amounts and release
  events both fully visible.

### 22. Failed or reversed ACH or card payment
- **Record status**: `payment_provider_transactions.status = 'failed'`
  or `'reversed'` (module 22) — the draw's balance reverts to unpaid,
  but the failed attempt remains a visible historical record, never
  deleted.
- **Approval**: none — system/provider-detected.
- **Reversal**: not applicable to the failed transaction itself; a
  successful retry is a new, separate transaction record.
- **Notification**: Client and Accounting both alerted immediately
  (Action Center event, Package 6b).
- **Audit**: every attempt (successful or not) stays in the payment
  history.

### 23. Refunds
- **Record status**: modeled as a negative payment-ledger entry
  (module 22) or a negative expense (module 3/4, already proven
  pattern), depending on whether it's a payment refund or a cost
  credit — never an edit to the original charge.
- **Approval**: Accounting/Owner, given financial impact.
- **Reversal**: not applicable — the refund is itself the correction.
- **Notification**: Client sees the refund on their statement.
- **Audit**: original charge and refund both fully visible.

### 24. Lost or damaged owner-supplied material
- **Record status**: the selection record (module 8) notes the
  loss/damage; if Stone Column bears replacement cost, a new expense is
  created against the relevant cost code — the original client-supplied
  selection record is not retroactively altered to hide that the
  original material was lost.
- **Approval**: PM confirms responsibility/cause before any
  replacement cost posts.
- **Reversal**: not applicable.
- **Notification**: Client notified given they originally supplied the
  material.
- **Audit**: the loss/damage note and any resulting replacement
  expense are both linked and visible.

### 25. Backordered or discontinued selections
- **Record status**: `selections.status` (module 8) gains a
  `backordered`/`discontinued` state distinct from the existing
  approval-pipeline statuses — this is a *fulfillment* problem, not an
  *approval* problem, and shouldn't be confused with "awaiting client
  decision."
- **Approval**: if discontinued, a new selection (re-approval required,
  never an edit to the old one — same versioning principle as every
  other selection change) must be chosen.
- **Reversal**: not applicable.
- **Notification**: Client and PM both alerted; this is a natural
  Action Center candidate once module 8 ships.
- **Audit**: the original selection, the backorder/discontinuation
  note, and any replacement selection all remain linked and visible.

### 26. Incorrect vendor paid
- **Record status**: the erroneous payment stays as a visible
  historical record (never deleted); a correcting entry recovers/
  reallocates the funds — modeled the same way as any other financial
  correction in this platform (reversing entry, not an edit).
- **Approval**: Owner/Accounting sign-off given the financial and
  vendor-relationship sensitivity.
- **Reversal**: a new, linked correcting transaction, not an edit to
  the original.
- **Notification**: both the incorrectly-paid vendor and the correctly-
  owed vendor should have clear records reflecting what actually
  happened.
- **Audit**: the complete before/after history remains visible — this
  is exactly the kind of error the append-only design throughout this
  platform exists to make recoverable without ambiguity.

### 27. Joint checks
- **Record status**: a payment made jointly to a vendor and their sub-
  supplier — modeled as a single payment record with two payee
  references, not two separate, seemingly-unrelated payments that
  don't reflect the joint-check reality.
- **Approval**: Accounting/Owner, often a condition of a lien waiver.
- **Reversal**: not applicable once issued.
- **Notification**: both payees should see their portion clearly.
- **Audit**: full joint-check detail retained, including why it was
  structured as one (commonly a lien-waiver condition, module 12).

### 28. Conditional and unconditional lien waivers
- **Record status**: `vendor_compliance` (module 12) tracks both waiver
  types distinctly — a conditional waiver (valid only once payment
  clears) is not the same record as an unconditional one (valid
  regardless), and the platform should never treat a conditional
  waiver as if it were unconditional before payment actually clears.
- **Approval**: Accounting confirms payment clearance before a
  conditional waiver is treated as satisfied.
- **Reversal**: not applicable.
- **Notification**: a payment-release workflow (module 6/22) should be
  aware of which waiver type is on file before releasing funds tied to
  it.
- **Audit**: full waiver history per vendor per payment.

### 29. Employee departure or permission removal
- **Record status**: `profiles.is_active = false` (already a real
  field in Package 1's schema) — never a deleted record, since audit
  history must survive the person's departure.
- **Approval**: Owner/Admin deactivates.
- **Reversal**: reactivation is possible (rehire) — a status change,
  not requiring a new record.
- **Notification**: none required beyond internal awareness.
- **Audit**: already fully supported — `audit_log` retains all of a
  deactivated user's historical actions unchanged; the self-escalation-
  blocking trigger already proven in Package 1 is exactly the same
  mechanism that should govern who *can* deactivate whom (not oneself).

### 30. Data export and project ownership transfer
- **Record status**: module 35 — a formal export capability, not an ad
  hoc database dump; "ownership transfer" (e.g., a project moving to a
  different Stone Column entity, or in an extreme case, to a client
  taking over their own records) should produce a complete, self-
  contained export a recipient could act on independently.
- **Approval**: Owner-only, given the sensitivity of a full project
  export.
- **Reversal**: not applicable — an export is a copy, not a move; the
  original platform data is unaffected by an export having been taken.
- **Notification**: none required beyond the export action itself
  being logged.
- **Audit**: every export logged (who, when, what scope).

### 31. Safety incident
- **Record status**: `safety_incidents` (module 28) — created once,
  never edited after the fact (append-only, same principle as
  inspections); follow-up actions are new, linked records.
- **Approval**: none required to create the record — an incident
  report should never be gated behind approval to exist, only to be
  formally closed.
- **Reversal**: not applicable.
- **Notification**: Owner/PM immediately; the involved vendor if
  their worker was involved.
- **Audit**: complete, immutable incident history — this is a legal/
  safety-compliance record, held to at least the same integrity
  standard as the financial schema.

### 32. Weather and force-majeure delay
- **Record status**: a `schedule_phases` (module 9) delay reason
  distinct from an ordinary schedule slip — tagged specifically as
  weather/force-majeure, since this often has contractual significance
  (excusable delay) that an ordinary internal delay doesn't.
- **Approval**: PM logs; may need Owner sign-off if it affects a
  contractual completion date.
- **Reversal**: not applicable.
- **Notification**: Client notified given schedule impact.
- **Audit**: delay reason and duration retained per phase, never
  overwritten by the next status update.

### 33. Lender underfunding or rejected draw
- **Record status**: `lender_draw_requests.status` (module 15) gains a
  `rejected`/`underfunded` state — the underlying client draw (module
  6) is not automatically affected; a lender-side rejection doesn't
  retroactively invalidate a client-facing draw, since they're related
  but distinct records.
- **Approval**: Owner/Accounting decides how to proceed (resubmit,
  address the lender's concern, or fund the gap another way).
- **Reversal**: not applicable — resubmission is a new, linked request.
- **Notification**: Owner alerted immediately (Action Center event,
  Package 12).
- **Audit**: every submission attempt and its outcome retained.

### 34. Scope performed by multiple vendors
- **Record status**: a single cost code can have multiple concurrent
  `committed_costs` rows (already structurally possible — unlike
  `forecast_entries`, `committed_costs` was never restricted to one
  active row per cost code) — no schema change needed, this is already
  supported, just needs to be confirmed as intentional UI behavior
  when Package 5 ships (show all vendors committed against a cost code,
  not just one).
- **Approval**: normal commitment approval per vendor.
- **Reversal**: standard supersede pattern per vendor's own commitment.
- **Notification**: none required beyond normal commitment workflow.
- **Audit**: already fully supported by existing schema design.

### 35. Project reopening after closeout
- **Record status**: `projects.status` moving from `closed_out` back to
  `active` — the enum already supports this transition (it's just a
  status value, not a one-way gate) but the platform should log
  *why* a closed project reopened (e.g., a warranty issue requiring
  active-project-level work, not just a warranty-claim record) — this
  is a new audit requirement, not a new schema table.
- **Approval**: Owner/PM sign-off, given the significance of reopening
  something considered done.
- **Reversal**: closing again is a normal forward status change.
- **Notification**: any client/vendor previously "closed out" of the
  project should be notified if reopening affects them.
- **Audit**: the reopen reason and who authorized it should be a
  first-class logged event, not just an incidental status-field change.

### 36. Duplicate contacts or companies
- **Record status**: two `profiles`/vendor-directory records that
  turn out to be the same person/company — resolved via an explicit
  "merge" action that preserves both records' full history under one
  surviving record, never a silent delete of one side that would break
  historical references (an old expense/commitment pointing at the
  now-deleted duplicate would become orphaned, which the append-only
  philosophy throughout this platform specifically exists to prevent).
- **Approval**: Owner/Admin confirms the merge.
- **Reversal**: a merge should be logged precisely enough to be
  manually reconstructed if it was made in error (this is a genuine
  edge case worth flagging as harder to cleanly reverse than most other
  scenarios in this register, given how many other records can
  reference a profile/vendor).
- **Notification**: none required beyond internal awareness.
- **Audit**: the merge action itself is logged (which record survived,
  which was merged into it, when, by whom).

### 37. Deceased/incapacitated client or changed signing authority
- **Record status**: `project_members` gains a new authorized
  decision-maker; the previous one's record is not deleted (their
  historical approvals/signatures remain valid and attributed to them),
  but their *ongoing* authority to approve new items is revoked.
- **Approval**: Owner confirms the change in signing authority, likely
  requiring legal documentation outside the platform itself (power of
  attorney, estate authority) — the platform's job is to correctly
  reflect the change once established, not to adjudicate it.
- **Reversal**: not applicable — this is a forward-only authority
  change.
- **Notification**: all parties (PM, other decision-makers, vendors
  with pending approvals) should see who the current authorized
  decision-maker is going forward.
- **Audit**: the full history of who was ever an authorized decision-
  maker, and when, is retained — this connects directly to Exception
  Register #12 (multiple decision-makers who disagree) and the
  approval-rule model resolved there
  (`docs/production-build/CLIENT-APPROVAL-MODEL.md` §5).
