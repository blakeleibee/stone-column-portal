# Stone Column Portal — Project Context

## What this is

The future operating platform for Stone Column Custom Homes &
Remodeling (cost-plus residential construction). QuickBooks Desktop
remains the system of record for accounting; this portal coordinates
construction operations and provides controlled interfaces for admin,
staff, client, vendor, investor, and lender roles.

## Current checkpoint

**Packages 1–2 are approved and remain the UX/product reference.** The
project has moved from prototype-expansion to a real production build,
per `docs/production-build/PRODUCTION-ROADMAP.md` (packages **P0–P15**),
which **supersedes** the old "Phase 2 Expanded Interactive Prototype →
Package 3" plan in `docs/product-definition/05-implementation-roadmap.md`
— no further prototype-only expansion is planned. See
`docs/production-build/TARGET-ARCHITECTURE.md` for the target stack
(Next.js on Vercel, Supabase Postgres/Auth/RLS) and
`docs/production-build/PRODUCTION-READINESS-AUDIT.md` for an honest,
module-by-module accounting of what's real vs. placeholder today.

**Do not start P1 or any later production package without explicit
approval.** P0 (Next.js migration, environment/secrets scaffolding —
no product scope change, no new backend) is the current active
package.

## What's real vs. what's a placeholder — read this before touching any screen

| Category | Where | Status |
|---|---|---|
| **Production-functional code** | `packages/01-financial-engine/` (budget/fee/reconciliation math), `packages/02-app-shell/` (`AppShell`, nav, `AdminFinancialsScreen`, `ClientBudgetAndInvoicesScreen`, view-model builders) | Real, tested, approved. No screen computes its own financial numbers — everything routes through this engine. |
| **Fixture-driven functional demonstrations** | `apps/web/` Overview and Financials/Budget screens, via `FixtureFinancialRepository` + `fixtures/hawksRidge.ts` | The real engine/components running against one hardcoded sample project ("Hawks Ridge Residence"). The math and view-model logic are genuine; only the data source is fake. |
| **Preview-only screens** | Everything else in `apps/web/src/screens/` — Action Center, Conversations, Contacts, Settings, Schedule, Selections, Documents/Updates | Static sample content, explicitly labeled "Preview only — not yet functional" in the UI. No backend, no persistence. |
| **Schema that exists but has never run** | `schema/*.sql` (migrations 001–005 + rollbacks), `tests/sql/*.sql` | Full Postgres/Supabase RLS design (roles: admin/staff/client/vendor; org scoping; append-only ledgers). Written and reasoned through carefully, but **never executed against a real database**. This is the standing, load-bearing caveat on the entire data layer — treat every SQL file as unverified until it's actually run. |
| **Planned only** | Vendor/Investor/Lender UI, auth (Supabase Auth), Leads, Estimating UI, QuickBooks import, Commitments/Bids, Billing/Draws, Payment Processing, Change Orders, Selections backend, Scheduling/Field Ops, Documents/RFIs, Conversations backend, Permits/Inspections, Warranty, Company Ops/Reporting, AI Assistance | Scoped in `docs/product-definition/01-feature-register.md`; sequencing now lives in `docs/production-build/PRODUCTION-ROADMAP.md` (P0–P15), which supersedes the old Packages 3–15 schedule. No code exists yet. |

## Non-negotiables (carried through every package)

- Money is always an integer number of cents. Never a float.
- No screen computes its own financial numbers — everything goes through `packages/01-financial-engine`.
- Nothing is silently overwritten, merged, or recalculated. Corrections are new ledger rows with a reason, not edits.
- Suggested numbers are never official until a human accepts/edits them.
- Client visibility requires both `status = 'published'` AND an explicit visibility flag — never one or the other.
- Internal notes never appear in any client- or vendor-facing query path.
- Every mobile-facing screen is designed portrait-first.
- **The project + cost-code ledger (`budget_ledger`/`expenses`/`committed_costs`/`forecast_entries`/`fee_ledger`, all joined to `cost_codes` via the composite `(cost_code_id, project_id)` foreign key) is the permanent financial backbone.** No future package introduces a parallel or duplicate financial data model — every new financial concept (vendor quotes, commitments, POs, forecasts, change orders, selections, draws, invoices, payments, retainage) references this same backbone via new tables and the registered `source_type`/`source_id` provenance convention. See `docs/production-build/FINANCIAL-ARCHITECTURE.md` (standing record, required reading before any package from P4 onward touches money).

## Client approval rule (decided — schema/UI not yet built)

- Projects may have multiple client contacts.
- Authorized decision-makers are explicitly designated.
- Approval requirements are configurable by project and record type.
- The approval record identifies the signer, authority, date, version, and relevant document.
- A disagreement or missing required signer creates a blocked/disputed state.
- The system never resolves client disagreement automatically.

The single-vs-multi-decision-maker question once flagged as open here
is resolved: the approval rule is a per-project, per-record-type
configuration (any-one / primary-binding / unanimous), not a fixed
platform choice. Full model: `docs/production-build/CLIENT-APPROVAL-MODEL.md`.
The `project_decision_makers` table and approval UI remain P2/P7/P8
scope — this is a design decision, not an implementation.

## Commands (from repository root)

```
npm ci             # install exact locked versions (preferred — do not use npm install unless the lockfile must change)
npm run typecheck  # tsc --noEmit in every workspace
npm run test       # every workspace's test suite (123 checks total)
npm run build      # production build of apps/web -> apps/web/.next/
npm run dev        # dev server for apps/web -> http://127.0.0.1:5173
```

## Where decisions live

- `docs/production-build/` — **current, authoritative plan for all work from here forward**: readiness audit, target architecture, prototype-to-production screen mapping, roadmap (P0–P15), data migration/fixture strategy, security & permissions matrix.
- `docs/product-definition/` — original prototype-era feature register, workflow map, exception & risk register, information architecture, change log, coverage matrix. Still the source for feature scope and terminology; no longer the source for package sequencing (see above).
- `docs/CHECKLIST.md` — most precise "what's actually done vs. deferred" record as of the prototype checkpoint.
- `docs/PACKAGE_01_CORRECTIONS*.md`, `docs/PACKAGE_02_CORRECTIONS*.md` — round-by-round correction history for Packages 1–2.
- `docs/INTERACTIVE_PREVIEW_HANDOFF.md`, `docs/PREVIEW_CHECKPOINT_NOTES.md` — what's genuinely real vs. a visual proxy in `apps/web`.

## Standing disclosures to preserve

- SQL/RLS has never been executed against a real Postgres/Supabase instance — do not describe it as verified. This is the first gate `docs/production-build/PRODUCTION-ROADMAP.md`'s P1 closes.
- CI (`.github/workflows/ci.yml`) runs typecheck/test/build on push/PR to `main`; no linter is configured yet.
- No authentication exists yet — the current preview app has no auth, no Supabase, no real credentials, by design.
- Git history begins at the imported baseline commit (`cd1c264` — "Import: original delivered Stone Column Portal ..."); nothing before that commit is reconstructable from this repo alone — see the correction-round docs in `docs/` for that history.
