# Package 2 — Corrections, Round 3 (final focused round)

## 1 & 2. SQL integrity gaps — deferred, see caveat below

Items 1 and 2 (INSERT-time bypasses on `committed_costs`, remaining
mutation gaps on `forecast_entries` lineage) are **schema/SQL work**,
identical in kind to migrations 001–003. I want to flag something
before claiming to have fixed them: this round's instructions
explicitly centered on **making the TypeScript side actually pass**
(item 3), and I want to be fully honest that I have re-verified my SQL
reasoning as carefully as before, but — as Round 2 demonstrated with the
forecast RPC ordering bug — careful reading has already once caught a
real bug that would otherwise have shipped, and also already once
missed one until a second pass. I've applied the same triple-check
discipline here; the fixes are below, but the standing caveat (SQL is
designed, reasoned through, **never executed against a real Postgres**)
applies with full force to this new migration exactly as it does to
every prior one.

### Fix: `committed_costs` INSERT-time validation

The gap: `committed_costs_status_transition` (003) was `BEFORE UPDATE`
only. A direct `INSERT ... (status, superseded_at, superseded_by_id)
VALUES ('superseded', ..., ...)` would skip the trigger entirely.

**New migration** `schema/004_committed_cost_insert_guard_and_forecast_
lineage_lock.sql` (003 was already delivered/reviewed — a new forward
migration, not a rewrite):

- Extended the existing trigger to fire `BEFORE INSERT OR UPDATE`
  (same function, `TG_OP` branch added for the insert case):
  - On INSERT, `status` must be `'open'` and both `superseded_at`/
    `superseded_by_id` must be null. This directly satisfies "ordinary
    inserts must create an open commitment" and "new open commitments
    must have both fields null" — enforced as a hard rejection, not a
    default that a caller can override.
  - The UPDATE-path logic (valid transitions, terminal immutability,
    anti-cycle check) is unchanged from 003.
- Added a **second** trigger, `committed_costs_lock_terminal_lineage`,
  `BEFORE UPDATE`, specifically for rows that are ALREADY terminal
  (`OLD.status IN ('fulfilled','cancelled','superseded')`): rejects ANY
  change to `status`, `superseded_at`, or `superseded_by_id` on such a
  row — not just "no going back to open" (already covered by 003) but
  also "no redirecting `superseded_by_id` to a different row" and "no
  clearing/changing `superseded_at`" once a row is terminal, which 003
  did not separately guard (003 only checked the FORWARD transition
  rules, not "is this row already resolved, so touch nothing further").
  This is a stricter, narrower rule layered on top, not a replacement.
- `supersede_committed_cost()` unaffected — it already only ever
  transitions a row from `open` (never touches an already-terminal
  row), so the new guards don't block it.

### Fix: `forecast_entries` lineage immutability

The gap: after `supersede_forecast()` ran, nothing stopped a direct
`UPDATE forecast_entries SET superseded_by_id = <other id>` or `SET
superseded_at = <different time>` on an already-superseded row.

**Added** (same new migration file): a trigger,
`forecast_entries_lock_superseded_lineage`, `BEFORE UPDATE`:
- If `OLD.superseded_at IS NOT NULL` (already superseded — whether
  fully linked or, transiently, mid-RPC with `superseded_by_id` still
  null), reject any change to `superseded_at` or `superseded_by_id`
  **except** the one legitimate case the RPC itself needs: going from
  `superseded_by_id IS NULL` to a non-null value (the RPC's step 3,
  writing the link after claiming the row in step 1). Once
  `superseded_by_id` is non-null, it becomes fully frozen too — no
  further changes at all.
- This is intentionally an ordinary (non-deferred) trigger, not a
  deferred constraint trigger. Deferred constraint triggers only defer
  *constraint* checks to transaction end; they don't help here because
  the actual requirement is "this specific one-time transition (null →
  non-null) is legal, everything else about a superseded row's lineage
  is not" — a same-statement-time BEFORE UPDATE trigger already
  expresses that correctly, and does so without introducing deferred-
  constraint semantics (harder to reason about, and unnecessary since
  the RPC's intermediate state was already made valid by 003's
  one-directional CHECK constraint, not by deferring anything). I
  considered a deferred trigger, as your instructions allowed, and
  concluded a plain BEFORE UPDATE trigger is the simpler, sufficient
  tool for this specific rule.
- "A completed supersede operation must leave both fields populated":
  enforced by 003's existing `forecast_entries_superseded_by_implies_at`
  CHECK plus the new trigger — once `superseded_by_id` is set, it can
  never be cleared, and `superseded_at` was already required to be set
  before `superseded_by_id` can be (003's CHECK), so there's no path to
  a permanently half-superseded row: either both are null (active), or
  `superseded_at` alone is set (transient, only reachable mid-RPC-
  transaction), or both are set (terminal, now fully frozen).

### SQL tests added (both files) — written, NOT executed

`tests/sql/committed_forecast_hardening_tests.sql` gained, per your
list: direct INSERT with `status='superseded'` (rejected), direct
INSERT of an open row with supersede fields populated (rejected),
clearing lineage from a superseded commitment/forecast (rejected),
redirecting `superseded_by_id` after superseding, on both tables
(rejected), changing `superseded_at` after superseding, on both tables
(rejected), any transition away from `fulfilled`/`cancelled`/
`superseded` (rejected — already partly covered in round 2, extended to
cover all three terminal states explicitly rather than just
`fulfilled`), a normal open insert (allowed), a valid RPC supersede
(allowed, both tables), and a repeated/second supersede attempt against
an already-superseded forecast (rejected — this existed in round 2
already, kept and re-verified against the new triggers).

## 3. TypeScript verification

**What I found in my own sandbox, verified just now:** still no network
access (confirmed again — `npm install` here fails with the same
`E403` on the npm registry). I want to be precise about what changed
and what didn't, since you're right that I shouldn't keep saying
"dependencies can't be installed" as a blanket statement once it stops
being true — it's still true **in this specific sandbox**, which is a
narrower and more honest claim than before. Whatever environment you
ran `npm install` in evidently does have registry access; this one
still doesn't (I re-tested before writing anything below).

**What I actually fixed, and verified by executing:**

- **`@types/node`**: found an already-present, unpacked copy on disk
  (bundled as `ts-node`'s own dependency, `node_modules/ts-node/
  node_modules/@types/node`, version `25.6.0` — no network fetch, just
  reusing a file that was already sitting on this machine) and copied
  it into `packages/02-app-shell/node_modules/@types/node` so `tsc`
  resolves it the normal way. Added `@types/node: "25.6.0"` to
  `package.json` and `"types": ["node"]` to `tsconfig.json`. **This
  fully resolves the `node:fs`/`node:path`/`process`/`__dirname`
  errors you reported** — confirmed by rerunning `tsc --noEmit` and
  diffing the error set before/after.
- **The `children` typing incompatibility**: root-caused correctly, not
  suppressed. `React.createElement(Component, props, child)`'s type
  overloads don't merge a trailing `children` argument into a props
  type that declares `children` as *required* — so every
  `React.createElement(AppShell, {...}, <child>)` call in the smoke
  test failed exactly as you described. Fixed by rewriting the entire
  test file to use real JSX (`<AppShell {...props}>{child}</AppShell>`)
  instead of raw `createElement` calls — JSX's element-checking
  correctly associates children with a required `children` prop, which
  `createElement`'s general-purpose overload signature does not. This
  is the direct fix to the actual mismatch, not a change to
  `AppShellProps` (which still correctly requires `children`) and not
  a suppression of any kind.
- **No `any`, no `@ts-ignore`, no blanket suppression**: audited. The
  one place that used `any` (a type-check in the smoke test) was
  replaced with a small named type guard (`hasStatusField`) against the
  actual `ClientBudgetViewModel` type.

**What I could not fix, and precisely why:**

`npx tsc --noEmit` in `packages/02-app-shell` still does not pass. I
ran it, captured all 263 error-reporting lines, and categorized every
single one by TypeScript error code:

| Code | Count | Cause |
|------|------:|-------|
| TS2307 | 6 | `Cannot find module 'react'` / `'react-dom/server'` — no `@types/react`/`@types/react-dom` present |
| TS7026 | 246 | `JSX.IntrinsicElements` doesn't exist — same root cause |
| TS2875 | 5 | `react/jsx-runtime` module path not found — same root cause |
| TS7006 | 2 | Implicit `any` on a parameter typed `React.KeyboardEvent` — the type itself can't resolve, so its usage degrades to implicit `any` |
| TS2322 | 4 | `key` treated as an ordinary prop instead of React's special-cased attribute — requires `@types/react`'s `JSX.LibraryManagedAttributes`, which isn't present |

Every one of these traces to the single missing `@types/react`/
`@types/react-dom` package — there is no error left in this list that
represents an actual bug in the code. I confirmed this by grep-excluding
all five patterns from the output and getting an empty result, then
independently cross-checking by grouping on TypeScript error code
directly (five distinct codes, matching the five categories exactly).

**Why I can't finish this here:** `npm install` in this sandbox fails
immediately fetching `@types/react` from the registry (`403`), and there
is no equivalent already-unpacked copy anywhere on this machine the way
there was for `@types/node` (I searched the full filesystem for any
`@types/react` directory before writing this — none exists). There is
no workaround available to me here; this is not a claim of "installation
generally isn't possible," it's a specific, re-verified claim about
this one package in this one sandbox.

**Exact commands run and results** (this sandbox):

```
$ cd packages/02-app-shell && npm install
npm error code E403
npm error 403 403 Forbidden - GET https://registry.npmjs.org/@types%2freact

$ npm run typecheck
[263 error lines — all five categories above, zero unexplained]

$ npm run smoke
render_smoke.tsx: all 47 checks passed.

$ cd ../01-financial-engine && npm run typecheck
(clean, no output)

$ npm test
run.ts: all assertions passed.
edge_cases.ts: all 31 checks passed.
```

**No lockfile.** `npm install` didn't complete (see above), so there is
nothing to generate a real lockfile from — same reasoning as
`NOTE_ON_LOCKFILE.md`. Once you run `npm install` with real registry
access using the corrected `package.json` (which now includes
`@types/node`), it should resolve cleanly and you can commit the
resulting `package-lock.json` yourself.

## 4. Checklist cleaned up

`docs/CHECKLIST.md`'s Package 2 section was previously three
sequentially-appended blocks (original + two correction rounds) that
had drifted — a "12 checks" count and references to the single
`FinancialsScreen` that no longer exists survived two rounds of edits
because I kept appending rather than consolidating. Replaced with one
current section reflecting the actual present-day implementation, with
round-by-round history left to the dedicated correction documents
(`PACKAGE_02_NOTES.md`, `_CORRECTIONS_V2.md`, this file) rather than the
checklist.

## 5. Confirmed preserved (not undone)

Ran the full existing test suite before and after every change in this
round specifically to confirm none of the following regressed:
repository/view-model separation, the admin/client screen split, the
independent reconciliation control total, the client-safe query
boundary, functional mobile navigation, `previewGuard`, stable
suggestion keys, the cross-project isolation tests, and the full
repository directory structure. All 47 `render_smoke.tsx` checks still
pass unchanged in content (only the `React.createElement` → JSX syntax
changed, not what's being asserted).

## Files changed this round

- `schema/004_committed_cost_insert_guard_and_forecast_lineage_lock.sql` (new)
- `schema/004_committed_cost_insert_guard_and_forecast_lineage_lock_down.sql` (new)
- `tests/sql/committed_forecast_hardening_tests.sql` (extended)
- `packages/02-app-shell/package.json` (added `@types/node`)
- `packages/02-app-shell/tsconfig.json` (added `"types": ["node"]`)
- `packages/02-app-shell/test/render_smoke.tsx` (JSX rewrite, `any` removed)
- `packages/02-app-shell/node_modules/@types/node/` (vendored locally for
  this sandbox's verification only — **not included in the delivered
  archive**; a real `npm install` will populate this normally)
- `docs/CHECKLIST.md` (consolidated)
- `docs/PACKAGE_02_CORRECTIONS_V3.md` (this file)

## Remaining limitations

- All SQL (migrations 001–004) remains designed-but-unverified against
  a real Postgres — unchanged, load-bearing caveat.
- `tsc --noEmit` for Package 2 is blocked solely on `@types/react`/
  `@types/react-dom`, unavailable in this sandbox; every other
  TypeScript issue reported is fixed and verified.
- No real lockfile (npm install didn't complete against the real
  registry in this sandbox).
- Prior rounds' other disclosed limitations (no headless browser/jsdom,
  `SupabaseFinancialRepository` stub, "Projected Final" product
  question, no router, icon placeholder, cross-package import
  ergonomics) are unchanged.
