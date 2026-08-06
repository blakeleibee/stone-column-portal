# Client Approval Model — Design Record

**Status:** Decided (documentation only — no schema/code in this
record). Resolves the open product question flagged in
`docs/product-definition/COVERAGE_MATRIX.md` ("One open product
question flagged, not yet resolved") and
`docs/product-definition/03-exception-and-risk-register.md` Exception
#12 (multiple client decision-makers who disagree) and #37
(deceased/incapacitated client or changed signing authority). Written
as part of the pre-P4 production-readiness checkpoint, per the standing
instruction in `CLAUDE.md`'s "Client approval rule" section.

**What this record is not:** a schema, migration, or RPC design. The
`project_decision_makers` table itself remains P2/P7/P8 scope, exactly
as `PRODUCTION-ROADMAP.md` already states — this record settles *what*
the model must support before that table is designed, so P7 (Change
Orders) and P8 (Selections) don't have to make this decision under time
pressure or discover it mid-build.

## The question this resolves

Exception #12 posed two options and left the choice open: a single
"primary decision-maker" whose approval is unilaterally binding, or
unanimous approval among every designated decision-maker. Forcing one
global answer was the wrong frame — different projects genuinely need
different rules (a single-owner spec home vs. a married couple who
insist on joint sign-off vs. an investor group with one managing
member). **The resolution is that the rule itself is a per-project,
per-record-type configuration, not a fixed platform behavior.**

## The model

### 1. Decision-makers are per-project, not global

- A project has zero or more designated decision-makers, each a
  reference to a project client contact (`project_clients`, from
  P2.1 — no new contact concept is introduced here).
- Designation is explicit and staff/admin-only — being a client
  contact on a project does **not** by itself confer approval
  authority. A contact must be affirmatively designated a
  decision-maker.
- A decision-maker's designation carries: which project, effective
  start date, and (per Exception #37) an effective end date when
  authority is revoked or transferred — never a delete. A superseded
  decision-maker's historical approvals remain intact and correctly
  attributed to them; only their *ongoing* authority to approve new
  items is revoked.

### 2. The approval rule is selectable per project (and may be overridden per record type)

Three named rules, covering the real spectrum identified in Exception
#12 rather than picking one:

| Rule | Behavior |
|---|---|
| **Any one** | The first designated decision-maker to respond (approve or reject) is binding. Best fit for a single point of contact, or clients who've told the builder either of them can decide. |
| **Primary binding** | One designated decision-maker is flagged as primary. The primary's approval or rejection is binding regardless of other decision-makers' responses. Non-primary decision-makers can still respond (visible to staff and to each other), but their response never blocks or overrides the primary's. |
| **Unanimous** | Every designated decision-maker must approve. A single rejection, or a designated decision-maker who hasn't responded by a defined deadline, keeps the record in a blocked/disputed state — never silently resolved by majority or default. |

- The rule is set at the project level as a default, with an explicit
  per-record-type override (e.g., a project could run "any one" for
  Selections but "unanimous" for Change Orders above a dollar
  threshold). A record type with no override uses the project default.
- Changing a project's approval rule is itself an audited action; it
  never retroactively changes the outcome of an already-resolved
  approval.

### 3. Disagreement and non-response never auto-resolve

This is unchanged from the existing non-negotiable and holds under all
three rules:

- **Unanimous**: any rejection, or any non-response past a configured
  deadline, produces a blocked/disputed state visible to staff. The
  system never proceeds on partial or assumed consent.
- **Primary binding**: a non-primary decision-maker's rejection does
  **not** block the record, but is recorded and surfaced to staff as a
  flagged disagreement on an otherwise-approved item — visibility, not
  silent override.
- **Any one**: if a second decision-maker later responds with a
  conflicting answer after the first response already made the record
  binding, the record's status does not change automatically; the
  conflicting response is recorded and surfaced to staff as a flagged
  disagreement, exactly like the primary-binding case. A record already
  finalized is never silently reopened by a later, contradictory
  response — reopening it is a distinct, explicit staff action (a new
  record/reversal, not an edit), consistent with the append-only
  philosophy used everywhere else in this schema.
- Every individual decision-maker's response is recorded separately and
  permanently — never merged into one "client approved" flag that loses
  who actually said what (Exception #12's audit requirement, unchanged).

### 4. What "the approval record" identifies

Matches `CLAUDE.md`'s existing Client Approval Rule bullets exactly —
this record adds no new requirement here, it only confirms none of them
conflict with the configurable-rule model above:

- The signer (which decision-maker).
- Their authority at the time (which rule was in effect, and whether
  they were acting as primary, one-of-unanimous, or any-one).
- Date and record version approved.
- The specific document/record approved.

### 5. Signing-authority changes (Exception #37)

A decision-maker's authority end date, combined with a new
decision-maker's start date, is sufficient to model a change in signing
authority (e.g., divorce, incapacity, estate transfer) without deleting
or rewriting history. The platform reflects the change once staff
establish it; it does not adjudicate legal authority itself — matching
Exception #37's existing "Owner confirms the change ... platform's job
is to correctly reflect it" framing.

## What remains for P2/P7/P8 to actually build

- `project_decision_makers` table: project reference, contact
  reference, `is_primary`, `effective_from`/`effective_to`, designation
  audit trail.
- Project-level default rule + per-record-type override storage.
- The approval-response table(s) each of P7 (Change Orders) and P8
  (Selections) already plan to build, now built against this shared
  rule model instead of each package inventing its own.
- The blocked/disputed-state UI and staff-facing disagreement flag.

None of the above is implemented by this record. This record exists so
that work starts from a settled model instead of an open question.
