# Handoff — P4 complete, GitHub still suspended, P5 not started

**Written:** 2026-08-08
**Local `main`:** `6e93a3a`
**Tag:** `p4-complete` → `6e93a3a` (confirmed, `git rev-list -n1 p4-complete`)
**Remote:** nothing pushed. Origin is `blakeleibee/stone-column-portal` on
GitHub; the account is suspended, so `git push`, `git fetch`/`ls-remote`,
and any `gh` command all fail with a 403 ("Your account is suspended").
Confirmed again this session, including a read-only `ls-remote` — this
is an account-level block, not a transient failure or a repo-permissions
issue. Treat it as the standing mode, not something to retry.

## Where things stand

P4 (Estimating & Budgeting UI + QuickBooks Desktop Import) is complete
and accepted, including a narrowly-scoped post-closeout fix. Full
record: `docs/milestones/P4-complete.md`.

- Original P4 closeout: `906f99c`..`6b8c988`/`19b9525` (12 tasks,
  subagent-driven development, whole-branch final review + fix wave).
- Post-closeout fix (this week): cross-import duplicate detection
  compared a raw, unnormalized CSV date string against Postgres's
  canonical `YYYY-MM-DD` — a `MM/DD/YYYY`-formatted QuickBooks export
  would never match an existing expense's date. Fixed with a
  `parseQuickBooksDate()` canonicalization function mirroring the
  existing `parseAmountToCents()` pattern; no migration needed (Postgres
  `::date` is DateStyle-independent for strict ISO input — verified,
  not just assumed). Commits `f034504` → `ae4b9b9` (independent-review
  fixes: year-0 guard, live-checkpoint consistency) → `511e275` →
  `6e93a3a` (docs).
- Independent review of the post-closeout fix: **Approved**, no Critical
  findings. One Important + six Minor findings, all resolved same-day
  rather than deferred.
- All verification re-run clean after the fix round: typecheck (3/3),
  `import_parse_unit.ts` 34/34, `run-sql-tests.mjs` 20/20 files,
  `npm run build` (24/24 routes), live checkpoint against the real
  hosted Supabase dev project 27/27.
- Working tree is clean. `next` is now an explicit dependency in
  `packages/02-app-shell/package.json` (previously hoisting-only).

Known limitations are all documented in `docs/milestones/P4-complete.md`
under **Known limitations** — nothing there is a blocker for P5, they're
recorded trade-offs (narrowed accepted date-format set, an
error-row-override edge case, a couple of low-materiality gaps).

## First thing next session

1. **Check whether GitHub access is restored** (`git ls-remote origin
   HEAD` is a safe, read-only check). Don't assume — confirm.
   - **If restored:**
     - `git push origin main`
     - `git push origin p4-complete` (this tag was moved locally with
       `-f`; since it was never pushed before, a plain push works — no
       force needed on the remote)
     - Confirm the remote tag resolves to `6e93a3a`
     - Open or update the PR covering P0–P4 (`gh pr create` / `gh pr
       list` to check for an existing one first)
     - Check CI status on that PR (`.github/workflows/ci.yml` — typecheck/
       test/build)
     - Report the PR link and CI status back
   - **If still suspended:** don't re-attempt or wait on it — just note
     it's still the case and keep working locally. No need to ask the
     user about it again unless they raise it; they're aware.

2. **Do not start P5 (Commitments, Bids, Procurement & Material Orders)
   without explicit approval.** The starter prompt already written for
   this transition is in `docs/milestones/P4-complete.md`'s final
   section ("Starter prompt for a fresh Claude Code session") — read
   that, plus `docs/production-build/PRODUCTION-ROADMAP.md`'s P5 section
   and `docs/production-build/FINANCIAL-ARCHITECTURE.md` for the
   cross-package constraints P5 must satisfy, then summarize scope and
   open questions and wait.

## Standing constraints that don't change with GitHub access

- Money as integer cents; no screen computes its own financial numbers;
  corrections are new ledger rows, never edits; the project + cost-code
  ledger is the permanent financial backbone (no parallel financial
  model, ever, in any future package).
- Every write path is a plain service function taking `supabase` as its
  first argument, called by a thin Server Action — never inline business
  logic, never a service-role shortcut — so the same functions are
  callable by both the UI and the future P15 AI assistant under the
  same authenticated session.
- SQL/RLS is exercised locally (PGlite test suite + the live hosted-
  Supabase checkpoint scripts) but has still never been exercised by a
  real end user outside these checkpoints — keep describing it that way.
