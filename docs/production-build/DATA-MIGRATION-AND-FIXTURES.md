# Data Migration and Fixtures

Defines the safe transition from today's fixture-only application to
one backed by live data, and how the two are kept from ever mixing
once production exists.

## Current fixture inventory (as of this audit)

| File | Contents | Currently consumed by |
|---|---|---|
| `packages/01-financial-engine/fixtures/hawksRidge.ts` | One complete fictional project ("Hawks Ridge Residence") — cost codes, budget ledger, expenses, committed costs, forecasts, fee rule, fee ledger | `FixtureFinancialRepository` only (grep-enforced — `packages/02-app-shell/test/render_smoke.tsx` asserts no production screen imports it directly) |
| `apps/web/src/data/sampleContent.ts` | Schedule phases, selections, documents, updates, conversation threads, action items, a hardcoded contact card | Every "later package" screen in `apps/web` (`ScheduleTab`, `SelectionsTab`, `DocumentsTab`, `UpdatesTab`, `ConversationsTab`, `ActionCenterScreen`, `ContactsScreen`) |
| `packages/02-app-shell/src/data/fixtureFinancialRepository.ts` | The one sanctioned adapter between the fixture data above and the `FinancialRepository` interface | `apps/web/src/App.tsx` (wires it up today), test files |

## Which fixtures remain, and for what

- **`fixtures/hawksRidge.ts` and `FixtureFinancialRepository` remain
  permanently** — not as production data, but as the fixture backing
  for `packages/01-financial-engine`'s and `packages/02-app-shell`'s
  own test suites (123 existing passing checks depend on exactly this
  data). Removing it would mean rewriting a large, currently-passing
  test suite for no benefit.
- **`sampleContent.ts` is retired incrementally, one array at a time,
  by the package that gives its screen a real table** (`SCHEDULE` →
  P9, `SELECTIONS` → P8, `DOCUMENTS`/`UPDATES` → P9, `CONVERSATIONS` →
  P10, `ACTION_ITEMS` → incremental per P4–P13, `CONTACT` → P3). A
  given array is deleted from this file in the same PR that wires its
  screen to a real table — it does not linger "just in case."
- **Storybook/demo use:** this repository has no Storybook today. If
  one is added later, it may reuse `fixtures/hawksRidge.ts` (already
  demo-shaped and stable) rather than inventing a second fixture set.

## How demo mode is isolated and visibly labeled today, and going forward

Today: `SampleDataTag` (`apps/web/src/components/SampleDataTag.tsx`)
renders "Sample data — Hawks Ridge Residence is a fictional demo
project" at the top of every screen's content, and every
`sampleContent.ts`-backed screen additionally renders its own "Preview
content — {package}" tag. This labeling discipline is good and
carries forward as a **requirement**, not just a nice-to-have:

- Any screen still reading from a fixture or static sample array after
  P0 must keep an explicit, visible label saying so — the label is
  removed in the exact same change that removes the fixture dependency,
  never before, never speculatively.
- The `DemoControls` role-switcher itself is a different case: it is
  not "sample data," it is a **fake authentication mechanism**, and
  per `PRODUCTION-ROADMAP.md` (P2) it is deleted outright once real
  auth exists — it does not get a "demo mode" label, because there is
  no safe way to leave a client-side role switch reachable in a build
  that also has real permissions to bypass.
- No environment variable or build flag should ever gate "is this
  fixture data" at runtime in a way that could be flipped in
  production by mistake — the correct mechanism is that fixture-backed
  code paths simply do not exist in the production build once their
  owning package lands (per the roadmap's "retired incrementally" rule
  above), not a runtime toggle that could be left on.

## Development seed data

Once P1 stands up a real local Supabase instance, local development
needs realistic-but-clearly-fake seed data distinct from the
fixtures above (fixtures are TypeScript objects for unit/UI tests;
seed data is real rows in a real local Postgres, for manual
click-through testing). Recommended approach, to be implemented
starting in P1/P3:

- A `supabase/seed.sql` (or equivalent) script, run only against
  local/preview environments, creating one or two clearly-fictional
  orgs/projects — reusing the "Hawks Ridge Residence" naming and
  numbers already established in `fixtures/hawksRidge.ts` for
  continuity, rather than inventing new fictional data with no
  relationship to what the test suite already uses.
- Never run against production, enforced procedurally (documented in
  the seed script's own header) and, once CI/CD exists, technically
  (the seed step is not part of the production deploy pipeline at all).

## Preventing sample data from ever entering production

- The production Supabase project is never seeded with
  `sampleContent.ts`/`hawksRidge.ts`/`seed.sql` data at any point —
  its first rows come only from real signups/real project creation
  (P2/P3) or a real, validated data import (below).
- `bootstrap_organization()` is gated (P2 acceptance criteria) so that
  production's first organization is created deliberately, not as a
  side effect of testing.
- CI's environment-variable and secret handling (P0) prevents a
  developer's local `.env` from accidentally pointing at the
  production Supabase project during manual testing — local/preview/
  production credentials are never the same value, and (P0
  acceptance criteria) nothing but `.env.example` is ever committed.

## Validating production data imports

Applies to the QuickBooks Desktop import (P4) and any future bulk
import: the existing `import_batches`/`import_rows` schema (already
modeled, unexecuted until P4) already encodes the right shape — a
`processing → ready_for_review → confirmed/cancelled` batch status,
row-level `match_status` (`new`/`changed`/`duplicate`/`unmatched`/
`error`/`excluded`), and a human confirmation step before any imported
row can become a `posted` expense. Nothing is posted automatically;
the reviewer sees exactly what will change before confirming.

## Schema changes and data backfills

- Every schema change is a new forward migration (per
  `TARGET-ARCHITECTURE.md` §13 and the standing instruction never to
  rewrite already-applied history).
- A backfill (populating a new column for existing rows) is written as
  its own migration step, reviewed the same as any schema change, and
  is idempotent (safe to re-run) wherever practical.
- Because the financial schema is append-only/supersede-based by
  design, most backfills in this system are additive (new columns
  defaulting to a safe value) rather than rewriting existing financial
  rows — consistent with the "never destructively modify finalized
  financial records" rule.

## Recovering from failed migrations and partial imports

- **Failed migration:** per `TARGET-ARCHITECTURE.md` §13, production
  migrations are forward-only — a failed migration is fixed by a new
  corrective migration, never a mechanical rollback of one that may
  have partially applied against real data. Local/CI environments may
  freely use the existing `_down.sql` files for a clean `up → down →
  up` cycle since nothing real is at stake there.
- **Partial import:** the `import_batches.status = 'cancelled'` path
  already models "abandon this batch" without needing a delete — any
  `import_rows` already matched/excluded stay as a record of what was
  reviewed and rejected, not silently removed. A cancelled batch's
  rows never reach `posted` status regardless of how far review got.
