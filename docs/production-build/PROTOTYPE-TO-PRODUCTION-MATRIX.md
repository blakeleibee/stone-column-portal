# Prototype-to-Production Matrix

Every screen/workflow currently in `apps/web` and
`packages/02-app-shell`, mapped to what production wiring it needs.
"Current route" is written as the `activeKey`/component name — **there
is no URL router in this repository today**, so nothing below is
actually deep-linkable yet; that gap is itself a P0/architecture item
(see `TARGET-ARCHITECTURE.md` §5).

## Legend for "Replacement status"

- **Real (keep)** — production-functional as-is, just needs a live
  data source wired in.
- **Fixture-backed** — real logic, fake data source.
- **Preview, inert** — static content, no interactivity of consequence.
- **Preview, misleading control** — renders a primary-action control
  (button) with no handler — actively looks more done than it is.
- **Demo-only, must be removed** — exists only to support the
  prototype; has no production role at all.

---

| Screen (current component) | Current data source | Intended production data source | Required tables | Required server operations | Required permissions | Required audit events | Required loading/empty/error states | Required tests | Production package | Replacement status |
|---|---|---|---|---|---|---|---|---|---|---|
| Admin Overview (`AdminOverviewScreen`) | `FixtureFinancialRepository` (real engine) + hardcoded `SELECTIONS` | Real admin financial rollup view/RPC + real `selections` query | `projects`, `cost_codes`, `budget_ledger`, `expenses`, `selections` (new) | Admin financial rollup RPC/view; selections-by-project query | Staff/admin, org-wide | None new (read-only screen) | Loading skeleton, "no pending decisions" empty state, fetch-error state — **none exist today** | Render test against real repo + RLS-scoped fetch test | P3 (real project data) + P8 (selections) | Fixture-backed |
| Financials tab (`AdminFinancialsScreen`) | `FixtureFinancialRepository` | `SupabaseFinancialRepository` (currently a non-functional stub — needs full implementation) | `cost_codes`, `budget_ledger`, `expenses`, `committed_costs`, `forecast_entries`, `project_fee_rules`, `fee_ledger` | Category-rollup view/RPC; independent-control-total RPC (must be genuine separate SQL aggregate, not a call into the rollup path) | Staff/admin, org-wide RLS (designed, unexecuted) | Already trigger-audited once schema is live; needs a UI to surface audit history (not built) | Loading, empty-project (no cost codes yet), fetch-error, RLS-denied states — none exist | Integration test against real Postgres RLS | P1 (schema execution) → P4 (budget-entry UI) | Fixture-backed |
| Client Budget & Invoices (`ClientBudgetAndInvoicesScreen`) | `FixtureFinancialRepository` (client-safe path) | `client_budget_view`/`client_expense_view` (already defined in schema, unexecuted) via real repository | Same as above + `import_batches` context | Client-safe view queries only — must never call internal engine functions or internal repository methods | Client, project-scoped RLS | Read-only; underlying rows already audited | Loading, empty-budget, fetch-error states — none exist | RLS test proving a client sees only their own project | P1 → P3 (read) → P6 (invoices, currently always empty) | Fixture-backed |
| Schedule (`ScheduleTab` / `ScheduleClientTab`) | Hardcoded `SCHEDULE` array | `schedule_phases` table | `schedule_phases` (new) | Read + (later) write/edit RPC | Staff/admin full; client/vendor scoped read | Full audit trail on any edit | Loading, empty-schedule, fetch-error — none exist | CRUD + RLS tests once table exists | P9 | Preview, inert |
| Selections (`SelectionsTab`) | Hardcoded `SELECTIONS` array | `selections` + `selection_approvals` tables | `selections`, `selection_approvals`, `project_decision_makers` (new, P2) | Approval RPC validating signer authority against `project_decision_makers`, recording signer/authority/date/version/document, blocking on missing-signer/disagreement | Client (own project, authorized decision-makers only for approval), staff/admin full, vendor scoped (P11) | Every approval action logged with full signer/authority/date/version/document per the preserved Client Approval Rule | Loading, empty-selections, "awaiting your decision" vs. "awaiting Stone Column", blocked/disputed state — **none exist** | Approval-authority enforcement test; disagreement/blocked-state test; "approval never happens from a single unreviewed click" test | P8 | **Preview, misleading control** — "Review & Approve (preview)" button has no `onClick` handler at all |
| Documents (`DocumentsTab`) | Hardcoded `DOCUMENTS` array | `documents` (metadata) + OneDrive/SharePoint (durable storage) | `documents` (new, metadata-only pattern per `expenses.onedrive_item_id`) | Publish/visibility-gated query; Microsoft Graph server-side calls for actual file access | Staff/admin full; client sees only `visible`/published rows | Publish-state changes audited | Loading, empty-documents, "file unavailable" states — none exist | Publish-gate test (Exception Register #14: accidental exposure) | P9 | **Preview, misleading control** — "Download" button has no handler |
| Updates & Photos (`UpdatesTab`) | Hardcoded `UPDATES` array + `PhotoPlaceholder` graphics | Likely folded into `documents`/daily-logs data model | New table TBD (daily-log or update-post shape) | Publish-gated query | Staff/admin full; client sees only published | Publish-state audited | Loading, empty, draft-vs-published states — none exist | Publish-gate test | P9 | Preview, inert |
| Conversations (`ConversationsTab`) | Hardcoded `CONVERSATIONS` array | `conversation_threads` + `messages` | `conversation_threads`, `messages` (new) | Send/reply RPC; "email reply is never an auto-approval" negative test path | Staff/admin full; client/vendor scoped to their own threads | Every message send audited | Loading, empty-inbox, send-failure states — none exist | Negative test: email reply must never be treated as a signed approval | P10 | Preview, inert |
| Action Center (`ActionCenterScreen`) | Hardcoded `ACTION_ITEMS` array | No single table — aggregated query per event type, sourced from each owning package's real table | N/A (aggregation, not a new table) | One query per event type (unapproved change orders, overdue selections, etc.), added incrementally per package | Staff/admin, scoped to their org's projects | N/A (read-only aggregation of already-audited events) | Loading, "nothing needs attention" empty state, partial-failure state (one event source down shouldn't blank the whole list) — none exist | Regression test: Action Center stays calm/actionable-only as sources are added (per old roadmap's own P14 requirement, still valid) | Incremental, starting **P4** | Preview, inert |
| Contacts (`ContactsScreen`) | `projectMeta.clientNames` (fixture, would be real project data) + hardcoded `CONTACT` constant | `project_members` + `profiles` (clients); a company staff directory (Module 23) for the Stone Column side | `project_members`, `profiles` (already exist) | Project-contact query | Staff/admin full; client sees own project's contacts | Contact changes audited via `project_members`/`profiles` triggers (need to confirm these get `log_audit()` attached) | Loading, empty-contacts states — none exist | RLS test: client cannot see another project's contacts | P3 (project contacts) → P14 (full staff directory) | Fixture-backed / Preview, inert (mixed) |
| Settings (`PlaceholderScreen`) | None — static "coming soon" card | Org profile, users/roles, cost-code library, templates | `orgs`, `profiles`, `cost_codes`, future `project_templates` | Admin-only mutation RPCs for each sub-area | Admin-only (not staff) for org/user management; staff+ for cost-code library | Every settings change audited | No states needed yet — literally nothing rendered but a placeholder | N/A yet | P2 (users/roles) + P3 (cost-code library) + P14 (templates) | Demo-only content, 0% backed |
| Role switcher / "Preview as Client" (`DemoControls.tsx`) | Local React state (`useState`), zero auth | Real Supabase Auth session; "preview as client" rescoped to a real, audited, staff-only impersonation feature | `profiles` (real role), new audit event for impersonation | Impersonation must call `assertNotPreviewing()` (already written in `previewGuard.ts`, currently unused) before every mutation, and log who previewed what and when | Staff/admin only for impersonation; never client/vendor | Every impersonation session start/end audited | N/A — this entire mechanism is replaced, not extended | Test: a real mutation attempted while previewing is rejected (contract already tested against the stub; needs a real mutating action to test against once one exists) | P2 (real auth) for removal; the audited "preview as client" replacement has no earlier consumer than the first package with client-mutating UI (P6/P7/P8) | **Demo-only, must be removed** from any build with real auth — not evolved, replaced |
| `AppShell` (nav, mobile drawer, "More" sheet) | N/A — pure UI shell, no data | Same component, wired to real URL routes | N/A | N/A | N/A | N/A | Already has real open/close/focus/ARIA behavior — no gap here | Already has 47 passing structural tests | N/A — needs a real router once adopted (see `TARGET-ARCHITECTURE.md` §5) | **Real (keep)** |
| Financial calculation engine (`packages/01-financial-engine`) | Pure functions, no data source of its own | Same functions, called again server-side against real data as the persisted/reported number | N/A (logic, not storage) | Re-executed server-side wherever a number is persisted, invoiced, or reported — never trusted only from a prior client-side computation | N/A (a library, not an endpoint) | N/A | N/A | Already has 123 passing tests | Reused unchanged from P1 onward | **Real (keep)** |

## Interactions that render correctly but currently do nothing when used

Called out separately per instruction ("identify prototype
interactions that are visually functional but currently do not
persist, authorize, validate, or audit real actions"):

1. **Selections → "Review & Approve (preview)"** — a full-width primary
   button, styled identically to a real call-to-action, with `onClick`
   entirely absent from the JSX. Clicking it does nothing.
2. **Documents → "Download"** — same pattern, no handler.
3. **Every tab inside `ProjectWorkspace`** (Schedule, Selections,
   Documents, Updates, Conversations) — switching tabs is real
   (`useState`), but every value displayed inside is static sample
   data; no fetch, no persistence, no possibility of a stale-data or
   error state because nothing is ever actually requested.
4. **"Preview as Client" banner + Exit control** — real UI behavior
   (the banner shows, the exit button works), but it toggles a local
   boolean with no relationship to any real permission boundary. It
   correctly does **not** overclaim in its copy ("Client preview," not
   a claim about real visibility rules) — this is good prototype
   discipline, but the entire mechanism still needs replacing per the
   row above, not just re-labeling.
