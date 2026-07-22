# P0 Logging & Monitoring Baseline

Restates and confirms `TARGET-ARCHITECTURE.md` §11 as the adopted
baseline for this package, and states plainly what's code, what's
dashboard configuration, and what's still an open owner decision.

## What's implemented in code by this package

- A root React error boundary (`apps/web/app/error.tsx`) wraps every
  route — a single screen's thrown render error shows a fallback
  message with a "Try again" control, not a blank page. This closes the
  "no error states anywhere" gap `PRODUCTION-READINESS-AUDIT.md` flags.

## What's runtime configuration, not code (no action needed in this repo to enable)

- **Vercel's built-in deployment/function logs and analytics** — on by
  default for any Vercel project, including this one once the Next.js
  build deploys. Nothing to configure.
- **Supabase's built-in Postgres logs and dashboard** — available once
  a real Supabase project exists (P1). Nothing to configure today.

## Explicitly deferred — a genuine owner decision, not silently added or silently skipped

- A dedicated error-reporting service (e.g. Sentry or equivalent) is
  **recommended but not assumed**, per `TARGET-ARCHITECTURE.md` §11 —
  it has a cost/plan implication. This package does not add one. If/when
  it's added, it wraps the same `app/error.tsx` boundary already in
  place rather than replacing it.
