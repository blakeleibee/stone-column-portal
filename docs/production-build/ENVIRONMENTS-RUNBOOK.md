# Environments Runbook

Operational companion to `TARGET-ARCHITECTURE.md` §1. That document
states *what* the three environments are; this document states *how*
to stand each one up and keep them wired correctly. No live Supabase
project exists yet as of this package (P0) — creating the first one is
P1's job. This runbook is the written procedure P1 follows.

## The three environments, restated precisely

| Environment | Supabase project | Hosting | Env vars live in |
|---|---|---|---|
| Local | Supabase CLI local stack (`supabase start`) | `next dev` (this package) | `.env.local` (gitignored, never committed) |
| Preview/staging | One shared Supabase project, or one ephemeral project per PR if branching is available on the plan in use | Vercel preview deployments (automatic per PR) | Vercel project's Preview environment variables |
| Production | Dedicated Supabase project | Vercel production deployment | Vercel project's Production environment variables |

**Never** the same Supabase project reused across two of these rows with
a "dev flag" distinguishing them — each is a genuinely separate project
with its own connection string, its own auth users, its own data.

## Standing rule

Local and preview both run the exact same migration files as production,
applied through the exact same tool (`supabase db push` or equivalent).
There is no environment-specific schema.

`schema/*.sql` (excluding `*_down.sql`) remains the single source of
truth. `supabase/migrations/*.sql` is a committed, regeneratable mirror
in the CLI's required `<timestamp>_<name>.sql` naming — `supabase db
push` cannot read `schema/` directly. Whenever `schema/` changes,
regenerate the mirror from the repo root before pushing:

```
rm -f supabase/migrations/*.sql
i=1
for f in schema/*.sql; do
  case "$(basename "$f")" in *_down.sql) continue;; esac
  ts=$(printf "202601%02d000000" "$i")
  cp "$f" "supabase/migrations/${ts}_$(basename "$f" | sed -E 's/^[0-9]+_//')"
  i=$((i+1))
done
```

First done as part of `docs/production-build/PRE-P4-CHECKPOINT.md`.

## What P1 does with this runbook

1. Run `supabase init` at the repo root (once).
2. Run `supabase start` to bring up the local Dockerized Postgres stack.
3. Apply `schema/001_core_financial.sql` through `005_*.sql` against it
   for the first time ever (this is P1's actual scope — see
   `PRODUCTION-ROADMAP.md`'s Package P1 section).
4. Create `.env.local` (gitignored) from `.env.example`, filled with the
   local stack's own URL/anon key (`supabase status` prints these).
5. Create the Preview Supabase project (or confirm branching is
   available on the current plan — a cost-linked decision flagged in
   `TARGET-ARCHITECTURE.md` §1, not assumed here) and set its
   corresponding variables in Vercel's Preview environment.
6. Create the Production Supabase project and set its variables in
   Vercel's Production environment. No sample/fixture data is ever
   seeded here (`DATA-MIGRATION-AND-FIXTURES.md`).

## What this package (P0) does NOT do

No live Supabase project of any kind is created in P0. `next dev` runs
today exactly as the old esbuild dev server did — against the fixture
repository (`FixtureFinancialRepository`), no environment variables
required to run it locally.
