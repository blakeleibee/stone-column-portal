# Stone Column Portal — Implementation Plan

Revision of the Phase 1 prototype into a production-ready MVP. Work is
split into 8 packages, built one at a time, each reviewed before the
next starts.

**Environment note:** this repo is being built inside a sandboxed chat
environment with no network access and no ability to provision live
infrastructure. Every package produces real, correct code, schema, and
architecture — but anything that requires an actual external service
(Supabase project, Microsoft Graph app registration, Vercel deploy,
live QuickBooks) is delivered as a schema-ready, wired-for-it module
with a documented "what a developer does to go live" step. Nothing is
labeled as working when it isn't — see each package's README for what's
real vs. schema-ready.

## Work packages

| # | Package | Status |
|---|---------|--------|
| 1 | Data model & financial engine | ✅ conditionally approved (SQL/RLS designed but unverified — see docs/PACKAGE_01_CORRECTIONS_V3.md) |
| 2 | App shell & responsive framework | ✅ done |
| 3 | Financials UI (budget table, drill-down, reconciliation, suggestions) | not started |
| 4 | Invoices/draws + change orders/field decisions | not started |
| 5 | Selections (category/room hierarchy, versioned approval) | not started |
| 6 | Import wizard (XLSX/CSV, dedupe, batches) | not started |
| 7 | Conversations + Action Center | not started |
| 8 | Vendor shell, OneDrive architecture, PWA/mobile polish, README | not started |

## Non-negotiables carried through every package

- Money is always an integer number of cents. Never a float.
- No screen computes its own financial numbers — everything goes
  through the Package 1 engine (`packages/01-financial-engine`).
- Nothing is silently overwritten, merged, or recalculated. Corrections
  are new ledger rows with a reason, not edits.
- Suggested numbers are never official until a human accepts/edits them.
- Client visibility requires both `status = 'published'` AND an
  explicit visibility flag — never one or the other.
- Internal notes never appear in any client- or vendor-facing query path.
- Every mobile-facing screen is designed portrait-first.
