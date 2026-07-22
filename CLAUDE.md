# Stone Column Portal — Project Context

## What this is

The future operating platform for Stone Column Custom Homes &
Remodeling (cost-plus residential construction). QuickBooks Desktop
remains the system of record for accounting; this portal coordinates
construction operations and provides controlled interfaces for admin,
staff, client, vendor, investor, and lender roles.

## Current checkpoint

**Packages 1–2 are approved.** The next required step is the **Phase 2
Expanded Interactive Prototype checkpoint**, which must be explicitly
reviewed and approved before **Package 3** begins. See
`docs/product-definition/05-implementation-roadmap.md` for the full
package plan and `docs/product-definition/COVERAGE_MATRIX.md` for a
one-page view of every review item and its destination package.

**Do not start Phase 2 or Package 3 work without explicit approval.**

## What's real vs. what's a placeholder — read this before touching any screen

| Category | Where | Status |
|---|---|---|
| **Production-functional code** | `packages/01-financial-engine/` (budget/fee/reconciliation math), `packages/02-app-shell/` (`AppShell`, nav, `AdminFinancialsScreen`, `ClientBudgetAndInvoicesScreen`, view-model builders) | Real, tested, approved. No screen computes its own financial numbers — everything routes through this engine. |
| **Fixture-driven functional demonstrations** | `apps/web/` Overview and Financials/Budget screens, via `FixtureFinancialRepository` + `fixtures/hawksRidge.ts` | The real engine/components running against one hardcoded sample project ("Hawks Ridge Residence"). The math and view-model logic are genuine; only the data source is fake. |
| **Preview-only screens** | Everything else in `apps/web/src/screens/` — Action Center, Conversations, Contacts, Settings, Schedule, Selections, Documents/Updates | Static sample content, explicitly labeled "Preview only — not yet functional" in the UI. No backend, no persistence. |
| **Schema that exists but has never run** | `schema/*.sql` (migrations 001–005 + rollbacks), `tests/sql/*.sql` | Full Postgres/Supabase RLS design (roles: admin/staff/client/vendor; org scoping; append-only ledgers). Written and reasoned through carefully, but **never executed against a real database**. This is the standing, load-bearing caveat on the entire data layer — treat every SQL file as unverified until it's actually run. |
| **Planned only** | Vendor/Investor/Lender UI, auth (Supabase Auth), Leads, Estimating UI, QuickBooks import, Commitments/Bids, Billing/Draws, Payment Processing, Change Orders, Selections backend, Scheduling/Field Ops, Documents/RFIs, Conversations backend, Permits/Inspections, Warranty, Company Ops/Reporting, AI Assistance | Scoped in `docs/product-definition/01-feature-register.md` and scheduled in `05-implementation-roadmap.md` (Packages 3–15). No code exists yet. |

## Non-negotiables (carried through every package)

- Money is always an integer number of cents. Never a float.
- No screen computes its own financial numbers — everything goes through `packages/01-financial-engine`.
- Nothing is silently overwritten, merged, or recalculated. Corrections are new ledger rows with a reason, not edits.
- Suggested numbers are never official until a human accepts/edits them.
- Client visibility requires both `status = 'published'` AND an explicit visibility flag — never one or the other.
- Internal notes never appear in any client- or vendor-facing query path.
- Every mobile-facing screen is designed portrait-first.

## Client approval rule (for future implementation — not yet built)

- Projects may have multiple client contacts.
- Authorized decision-makers are explicitly designated.
- Approval requirements are configurable by project and record type.
- The approval record identifies the signer, authority, date, version, and relevant document.
- A disagreement or missing required signer creates a blocked/disputed state.
- The system never resolves client disagreement automatically.

(This is currently an open product question flagged in
`docs/product-definition/COVERAGE_MATRIX.md` — a decision on
single-decision-maker vs. multi-decision-maker approval is needed
before Package 7 (Change Orders) or Package 8 (Selections) is built.)

## Commands (from repository root)

```
npm ci             # install exact locked versions (preferred — do not use npm install unless the lockfile must change)
npm run typecheck  # tsc --noEmit in every workspace
npm run test       # every workspace's test suite (123 checks total)
npm run build      # production build of apps/web -> apps/web/dist/
npm run dev        # dev server for apps/web -> http://127.0.0.1:5173
```

## Where decisions live

- `docs/product-definition/` — feature register, workflow map, exception & risk register, information architecture, implementation roadmap, change log, coverage matrix
- `docs/CHECKLIST.md` — most precise "what's actually done vs. deferred" record
- `docs/PACKAGE_01_CORRECTIONS*.md`, `docs/PACKAGE_02_CORRECTIONS*.md` — round-by-round correction history for Packages 1–2
- `docs/INTERACTIVE_PREVIEW_HANDOFF.md`, `docs/PREVIEW_CHECKPOINT_NOTES.md` — what's genuinely real vs. a visual proxy in `apps/web`

## Standing disclosures to preserve

- SQL/RLS has never been executed against a real Postgres/Supabase instance — do not describe it as verified.
- No lint/CI configuration exists yet.
- No authentication exists yet — the current preview app has no auth, no Supabase, no real credentials, by design.
- Git history begins at the imported baseline commit (`cd1c264` — "Import: original delivered Stone Column Portal ..."); nothing before that commit is reconstructable from this repo alone — see the correction-round docs in `docs/` for that history.
