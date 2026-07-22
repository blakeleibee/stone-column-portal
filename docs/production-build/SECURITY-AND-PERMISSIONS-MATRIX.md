# Security and Permissions Matrix

A record-level access target for the eleven roles named in this
checkpoint. **This is a policy target, not a description of what's
enforced today** — see the role-model gap called out immediately
below before reading the matrix as if it were already implemented.

## Role-model gap — read this first

The schema's `app_role` enum today (`schema/001_core_financial.sql`)
has exactly four values: `admin`, `staff`, `client`, `vendor`.
`PRODUCTION-ROADMAP.md` adds `investor`/`lender` in P12. That's six.
The eleven roles requested for this matrix include five that **do not
correspond to a distinct enum value in any current or planned
migration**:

- **Project Manager**, **Superintendent/Field Staff**, and
  **Accounting** are all, today, the single `staff` role — the schema
  has no sub-role distinction between them at all. **UI-only
  enforcement of the narrower permissions below is not an acceptable
  production option** — UI visibility is never authorization, and a
  row like Payments (Superintendent: ❌ everywhere) means nothing if
  the database itself would still serve a Superintendent-role request
  because RLS only ever checked `role in ('admin','staff')`. This must
  be enforced server-side: by RLS policies and by the trusted-server
  operations described in `TARGET-ARCHITECTURE.md` §5, not by which
  buttons a screen happens to render.

  The forward-compatible model (does **not** require promoting every
  job title to its own `app_role` enum value):
  1. **Organization-level staff function** — a new column (working
     name `profiles.staff_function`, e.g.
     `'project_manager' | 'superintendent' | 'accounting' | 'general'`),
     consulted the same way `profiles.role` already is today, by a new
     helper function (e.g. `has_staff_function(p_org_id, p_function)`)
     following the exact `SECURITY DEFINER`/`search_path`/`revoke-then-
     grant-to-authenticated` pattern `is_org_staff_for_org()` already
     establishes. This is additive to `role`, not a replacement for
     it — `role = 'staff'` still gates "is this an internal user at
     all"; `staff_function` narrows *which* internal capabilities they
     have.
  2. **Project-specific assignment/role** — `project_members` (today
     scoped to `client`/`vendor` only via
     `project_members_client_or_vendor_only`) is extended so staff can
     also carry a project-specific assignment (e.g., "PM on Project A,
     no assignment on Project B") where finer project-level scoping is
     genuinely needed, rather than every staff permission being
     org-wide by default.
  3. **Narrowly scoped permission overrides** — only where 1–2
     genuinely don't cover a real case (e.g., a one-off "let this
     Superintendent view Payments on this single project for a
     transition period") — a small, explicitly audited override table,
     not a general-purpose permission-bag that reintroduces the same
     "is this actually enforced or just displayed" ambiguity this
     correction exists to close.
  This model is settled direction, not an open decision — see the
  executive summary in the PR description for what's still genuinely
  undecided (there isn't a staff-role question left in that list).
- **Authorized Client Decision-Maker** is not a role at all in the
  schema sense — it's the `project_decision_makers` flag on a `client`
  described in `TARGET-ARCHITECTURE.md` §3. The matrix below treats it
  as a modifier on the `Client` row (same visibility, added approval
  authority), not a separate `app_role` value.
- **Architect/Designer** and **Read-Only Guest** appear nowhere in
  `docs/product-definition/01-feature-register.md`'s 35 modules and
  have no planned schema role at all. They're modeled below at the
  policy level (what they *should* be able to do) with an explicit
  flag that schema work to represent them doesn't exist yet in any
  roadmap package.

This lands no later than **P3**, since P3 is where team/permissions UI
is first built — building that screen against an undifferentiated
`staff` role and retrofitting `staff_function` afterward means
building the RLS layer twice.

## Legend

- **✅** — full access within the role's scope.
- **Own** — only records the individual created or is directly tied to.
- **Assigned** — only records explicitly assigned/shared with them
  (project membership, vendor assignment, document publish flag).
- **Published** — only records marked client/vendor-visible
  (`publication_status = 'published'` or equivalent).
- **❌** — no access.
- **N/A** — action doesn't meaningfully apply to this record type.

Columns: **View / Create / Edit / Approve / Reverse / Export /
Administer.** "Reverse" means issuing a correction/reversal entry
against a finalized record (never a destructive edit — see
`TARGET-ARCHITECTURE.md` §4/§6). "Administer" means changing who else
can access the record type at all (permissions, publish/visibility
settings), not just editing the record's own content.

---

### Projects

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ org-wide | ✅ | ✅ | N/A | N/A | ✅ | ✅ |
| Project Manager | Assigned | ❌ | Assigned | N/A | N/A | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Accounting | ✅ org-wide | ❌ | ❌ | N/A | N/A | ✅ | ❌ |
| Client | Own project | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Architect/Designer | Assigned | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Vendor/Subcontractor | Assigned (own membership only) | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Investor | Own stake's project, summary only | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Lender | ❌ (draw package only, no project view) | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Read-Only Guest | Assigned, if explicitly shared | ❌ | ❌ | N/A | N/A | ❌ | ❌ |

### Contacts

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | N/A | N/A | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | N/A | N/A | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Accounting | ✅ | ❌ | ❌ | N/A | N/A | ✅ | ❌ |
| Client | Own project | ❌ | Own | N/A | N/A | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project | ❌ | Own | N/A | N/A | ❌ | ❌ |
| Architect/Designer | Assigned | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Vendor/Subcontractor | Own contact only | ❌ | Own | N/A | N/A | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |

### Estimates

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | ❌ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned (read) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Client | Own project, client-safe view | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project, client-safe view | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architect/Designer | Assigned (read, design-relevant) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | Summary only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Budgets (revised estimate / approved-change ledger)

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ❌ (append-only — see note) | ✅ | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | ❌ | ✅ (internal changes) | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Client | Own project, client-safe view | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project, client-safe view | ❌ | ❌ | ❌ (approves change orders, not raw budget lines) | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | Summary only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

*Note: `budget_ledger` is append-only by database trigger — "Edit" is
`❌` for every role, including admin, by design (matches
`budget_ledger_append_only` in `schema/001_core_financial.sql`, which
rejects `UPDATE`/`DELETE` for **any** role including a service-role
key). Corrections are new `entry_type = 'correction'` rows, which is
what "Reverse" means in this row.*

### Actual Job Costs (expenses)

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | Pre-posted only | ✅ (post) | ✅ (void + correct) | ✅ | ✅ |
| Project Manager | Assigned | ✅ (pending only) | Own pending | ❌ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ✅ | Pre-posted only | ✅ | ✅ | ✅ | ❌ |
| Client | Own project, posted+published only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project, posted+published only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ (summary rollup only, never raw expense rows) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

*Matches `enforce_expense_state_transition()`: once `posted`, financial
fields are frozen for every role — "Edit" only applies pre-posting.*

### Commitments (committed_costs / POs / subcontracts)

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | Supersede only | ✅ | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Supersede only | ✅ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Client | ❌ (internal-only, no client RLS policy exists) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own commitment only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Vendor Bids

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | ✅ (award) | ✅ (cancel) | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | ✅ (award) | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ (read, for commitment linkage) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Client | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own bid only — **must never see a competing bid** | ✅ (own submission) | Own, pre-close | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

*Competing-bid isolation is non-negotiable per
`docs/product-definition/01-feature-register.md` module 12 — this row
is the RLS requirement that statement translates to.*

### Draws and Invoices

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | Draft only | ✅ (issue) | ✅ (correct finalized draw) | ✅ | ✅ |
| Project Manager | Assigned | ✅ (draft) | Draft only | ❌ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ✅ | Draft only | ✅ | ✅ | ✅ | ❌ |
| Client | Own project, issued only | ❌ | ❌ | ✅ (acknowledge, if decision-maker) | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project, issued only | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own vendor invoice only | ✅ (own invoice submission) | Own, pre-approval | ❌ | ❌ | ❌ | ❌ |
| Investor | Summary only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | Own single open draw package only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Payments

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ (record manual payment) | ❌ | N/A | ✅ (refund/reversal) | ✅ | ✅ |
| Project Manager | Assigned (read) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ✅ | ❌ | N/A | ✅ | ✅ | ❌ |
| Client | Own, initiates via provider (P6b) | ✅ (initiate payment only) | ❌ | N/A | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own | ✅ (initiate payment only) | ❌ | N/A | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own payment/retainage status only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Change Orders

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | Pre-signature | ✅ (emergency-authorize, Exception #5) | ✅ (cancel/void) | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Pre-signature | ❌ (initiates, doesn't approve) | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned (read) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Client | Own project | ❌ | ❌ | ❌ (views only unless decision-maker) | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project | ❌ | ❌ | ✅ (binding signature) | ❌ | ❌ | ❌ |
| Architect/Designer | Assigned (read, design-relevant) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own scope's change orders only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Selections

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | Pre-approval | ✅ (override, exceptional) | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Pre-approval | ❌ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned (read) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ (read, allowance-vs-actual only) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Client | Own project | ❌ | ❌ (proposes preference, doesn't finalize) | ❌ unless decision-maker | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Architect/Designer | Assigned | ✅ (proposes options) | Assigned, pre-approval | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own assigned fulfillment scope only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Documents (client/vendor-facing, publish-gated)

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | ✅ (publish) | ✅ (withdraw) | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | ✅ (publish, project-scoped) | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ (field docs/photos) | Own | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ (financial docs) | ✅ | Own | ❌ | ❌ | ✅ | ❌ |
| Client | Own project, published only | ❌ | ❌ | N/A | ❌ | Published only | ❌ |
| Authorized Client Decision-Maker | Own project, published only | ❌ | ❌ | N/A | ❌ | Published only | ❌ |
| Architect/Designer | Assigned, design-relevant | ✅ (plan revisions) | Own | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Assigned, explicitly shared only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | Assigned, explicitly shared only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | Draw package documents only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | Explicitly shared only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Internal Documents (never client/vendor-visible by definition)

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Own | N/A | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ | Own | N/A | ❌ | ❌ | ❌ |
| Accounting | ✅ | ✅ | Own | N/A | ❌ | ✅ | ❌ |
| Client | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |

*This is the row that makes Exception Register #14 ("confidential
internal files accidentally exposed") concrete — every cell for every
non-staff role is `❌`, no exceptions, and this must be the literal RLS
policy default (no matching policy = zero rows), not an
application-layer filter.*

### Schedules

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | N/A | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ | Assigned | N/A | ❌ | ❌ | ❌ |
| Accounting | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Client | Own project, client-safe | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project, client-safe | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Architect/Designer | Assigned | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own scope's dates only | ❌ | ✅ (confirm/flag conflict) | N/A | ❌ | ❌ | ❌ |
| Investor | Summary only | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Read-Only Guest | Explicitly shared only | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |

### Daily Logs

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | N/A | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ | Own | N/A | ❌ | ❌ | ❌ |
| Accounting | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Client | ❌ (internal by default; a published excerpt may surface as an "Update") | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Same as Client | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Architect/Designer | Assigned (read) | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |

### RFIs

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | ✅ (respond/close) | ✅ (reopen) | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | ✅ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ | Own | ❌ | ❌ | ❌ | ❌ |
| Accounting | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Client | ❌ (typically internal-to-trade unless explicitly shared) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Same as Client | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architect/Designer | Assigned | ✅ (respond to design questions) | Own response | ✅ (design-question resolution) | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own submitted RFIs only | ✅ (submit) | Own, pre-answer | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Inspections

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ❌ (append-only history) | N/A | N/A | ✅ | ✅ |
| Project Manager | Assigned | ✅ | ❌ | N/A | N/A | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ | ❌ | N/A | N/A | ❌ | ❌ |
| Accounting | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Client | Own project, status only (not raw report) | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Authorized Client Decision-Maker | Same as Client | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Architect/Designer | Assigned | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Vendor/Subcontractor | Own scope's inspection results only | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | N/A | N/A | ❌ | ❌ |

*Inspection history is append-only by requirement — "Edit" is `❌` for
every role, a failed inspection is followed by a new passed record,
never an edit to the failed one.*

### Warranty

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | ✅ (resolve) | ✅ (reopen) | ✅ | ✅ |
| Project Manager | Assigned | ✅ | Assigned | ✅ | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | Assigned | ✅ | Own | ❌ | ❌ | ❌ | ❌ |
| Accounting | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Client | Own project | ✅ (submit claim) | Own, pre-resolution | ✅ (acknowledge resolution) | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | Own project | ✅ | Own | ✅ | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | Own assigned claims only | ❌ | Own assigned | ❌ | ❌ | ❌ | ❌ |
| Investor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Investor Reports

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ | ✅ | ✅ | ✅ (publish) | ✅ | ✅ | ✅ |
| Project Manager | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Superintendent/Field Staff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounting | ✅ (prepares figures) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Client | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Investor | **Own stake only** — must never see another investor's stake or raw vendor invoices | ❌ | ❌ | ❌ | ❌ | Own | ❌ |
| Lender | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Audit History

**⚠️ Known contradiction, flagged as a P1/P2 security defect —
read before using this table.** The columns below describe the
*target* differentiated access this matrix requires. The schema as it
actually exists today does **not** implement this differentiation:
`audit_log_staff_select` reads `using (project_id is not null and
is_org_staff(project_id))`, and `is_org_staff()` /
`is_org_staff_for_org()` both resolve true for **any** `role in
('admin', 'staff')` — meaning, as written, a Superintendent (today
indistinguishable from a PM or Accounting at the database level — see
the role-model gap above) can read **every audited row for every
project in the org**, including full `before_data`/`after_data`
financial snapshots. This must be corrected before any sensitive
production audit data is generated — audit rows created under the
current policy, before the fix ships, would already have been
over-exposed by the time anyone noticed.

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ org-wide | System-only (trigger-generated) | ❌ (immutable) | N/A | ❌ | ✅ | ✅ |
| Project Manager | Assigned (project-scoped only — their own assigned projects, not org-wide) | System-only | ❌ | N/A | ❌ | Assigned | ❌ |
| Superintendent/Field Staff | ❌ (no default access — schedules/daily-logs/field-record audit trail only, if genuinely needed, via a narrow override per the role-model gap above, never the general financial audit log) | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Accounting | ✅ (financial tables only — `expenses`, `budget_ledger`, `fee_ledger`, `committed_costs`, `forecast_entries`, `budget_suggestions`; not HR/personnel-adjacent audit rows if any such table is ever added) | System-only | ❌ | N/A | ❌ | ✅ | ❌ |
| Client | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Investor | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Lender | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |

**Required correction (P1 discovery, P2 fix — tracked in
`PRODUCTION-ROADMAP.md`):**
1. `audit_log_staff_select` is replaced with `staff_function`-aware
   policies once P2's `staff_function` column exists: Owner/Admin get
   org-wide read; Project Manager gets read scoped to their assigned
   projects only (via the P3 project-assignment model); Accounting
   gets read scoped to financial-table audit rows; Superintendent gets
   **no default access** to `audit_log` at all.
2. **Sensitive field redaction/exclusion:** `log_audit()` currently
   stores the complete `to_jsonb(OLD)`/`to_jsonb(NEW)` row for every
   audited table. Before this data is queryable by anyone other than
   Owner/Admin, define which columns (if any) are excluded or redacted
   per table/role — e.g., a PM reading their own project's audit trail
   is an intended use case, but should not incidentally see a field
   never meant to be part of that record's own visible surface. This
   needs a concrete column-level decision per table during P2, not a
   blanket "audit is admin-only" dodge that defeats the point of
   giving PM/Accounting real audit access at all.
3. **Tests required, not optional:** an automated test proving a
   Superintendent-function staff account, given a valid session,
   cannot retrieve any `audit_log` row via any query path (direct
   table read, view, or RPC); a second test proving a PM-function
   account can read only rows for projects they're assigned to, not
   another PM's project. Both tests are part of P1/P2's acceptance
   criteria, not a follow-up item.

*The append-only mechanics remain accurate as designed: `audit_log`
has no `insert`/`update`/`delete` policy for any role — only
`log_audit()` (SECURITY DEFINER) writes to it. "Create" is
`System-only` for every role including admin because there is
deliberately no human-writable path to this table at all. Only the
**read** policy's granularity is the defect.*

---

## Cross-references

- The Client Approval Rule preserved for this checkpoint (multiple
  contacts, explicit decision-maker designation, per-project/per-
  record-type configurable requirements, full signer/authority/date/
  version/document capture, blocked/disputed state on disagreement,
  never auto-resolved) is what the "Authorized Client Decision-Maker"
  row's Approve column represents throughout this matrix — it is not a
  one-off exception, it's the same rule applied consistently to
  Change Orders, Selections, and Draws.
- Every `❌` cell in the "Internal Documents," "Commitments," and
  "Vendor Bids" rows for non-staff roles is a direct RLS requirement,
  not a UI-hiding suggestion — per `TARGET-ARCHITECTURE.md` §4, the
  safe default for an RLS-enabled table with no matching policy is
  zero rows, and that is the mechanism these `❌`s rely on.
