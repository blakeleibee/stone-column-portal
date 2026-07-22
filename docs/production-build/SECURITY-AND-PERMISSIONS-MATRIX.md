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
  has no sub-role distinction between them at all. Enforcing the
  narrower permissions below (e.g., Superintendent cannot view payment
  data; Accounting cannot edit daily logs) requires either (a) a new
  `staff_function` column on `profiles` consulted by RLS policies and
  helper functions, or (b) accepting that these three rows are enforced
  at the UI layer only, with the database continuing to treat them as
  one undifferentiated `staff` role. **This is a real decision, not a
  detail** — it changes how many RLS policies P2 onward has to write.
  See the executive summary.
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

Recommendation: resolve the `staff` sub-role question (flag column vs.
UI-only) no later than **P3**, since P3 is where team/permissions UI
is first built — building that screen without deciding this first
means building it twice.

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

| Role | View | Create | Edit | Approve | Reverse | Export | Administer |
|---|---|---|---|---|---|---|---|
| Company Owner/Admin | ✅ org-wide | System-only (trigger-generated) | ❌ (immutable) | N/A | ❌ | ✅ | ✅ |
| Project Manager | Assigned (read) | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Superintendent/Field Staff | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Accounting | ✅ | System-only | ❌ | N/A | ❌ | ✅ | ❌ |
| Client | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Authorized Client Decision-Maker | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Architect/Designer | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Vendor/Subcontractor | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Investor | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Lender | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |
| Read-Only Guest | ❌ | System-only | ❌ | N/A | ❌ | ❌ | ❌ |

*Matches the schema exactly as designed: `audit_log` has no `insert`/
`update`/`delete` policy for any role — only `log_audit()` (SECURITY
DEFINER) writes to it, and only `audit_log_staff_select` grants read,
scoped to org staff. "Create" is `System-only` for every role including
admin because there is deliberately no human-writable path to this
table at all.*

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
