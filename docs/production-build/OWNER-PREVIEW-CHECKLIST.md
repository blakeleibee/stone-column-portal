# Owner Preview Checklist

**Status: DRAFT**, pending owner review alongside `PRODUCT-VISION.md`
and `PRODUCT-COMPLETENESS-MATRIX.md`. Once approved, use this for
**every** live owner preview of every future package (P5's remaining
tasks onward) — it operationalizes `PRODUCT-VISION.md` §6 ("What
'done' means") into something concrete to walk through together,
so a preview is a workflow review, not a compile check.

**How to use it:** work top to bottom against whatever workspace is
being previewed. Not every section applies to every workspace (a
read-only report screen has no "create" step; a client-facing screen
has no desktop-only requirement) — skip what genuinely doesn't apply
and say so, rather than silently omitting it. Anything checked "No" or
"Partial" gets a one-line note and either a fix before sign-off or an
explicit, named deferral to a specific future task/package — never a
silent gap.

---

## 1. Project context

- [ ] The screen makes it unambiguous which project is currently being
      viewed/edited.
- [ ] Switching projects (if the screen supports it) actually changes
      every figure/list on screen — nothing left over from the
      previous project.
- [ ] If no real project-switching exists yet for this screen, that's
      named explicitly as a known limitation of *this* preview, not
      silently assumed away.

## 2. Role & permission boundaries

- [ ] Confirm which role(s) this preview is being driven as.
- [ ] Log in (or reason through, if a second account isn't available)
      as at least one role that should **not** see this data or take
      this action — confirm it's actually blocked, not merely
      unlinked in the nav.
- [ ] Confirm the blocking happens at the data layer (RLS/server), not
      only in the UI — ask "what would a direct API/RPC call as that
      role return?" if it can't be observed directly.
- [ ] For client/vendor/investor/lender-facing data: confirm internal
      notes, draft/unpublished records, and other-party data are
      genuinely absent, not just visually hidden.

## 3. Core lifecycle: create / view / edit / archive / recover

- [ ] **Create:** the normal path to create a new record is
      discoverable and works, including the validation on required
      fields.
- [ ] **View:** a created record displays correctly, including any
      computed/rolled-up figures.
- [ ] **Edit:** editable fields update correctly; fields that should be
      frozen (per the record's own architecture — e.g. a posted
      expense, a committed line item) are genuinely frozen, not just
      discouraged.
- [ ] **Archive vs. delete:** if the record type distinguishes them
      (most financial/history-bearing records should), confirm delete
      is rejected once the record has real history, and archive works
      as the fallback.
- [ ] **Recovery:** if a mistake is recoverable by design (draft →
      submit, archive → reactivate), confirm the recovery path
      actually works, not just the forward path.
- [ ] **Correction vs. edit:** for anything append-only, confirm a
      correction produces a new row/version, not a silent overwrite of
      history.

## 4. Empty states & first run

- [ ] A brand-new project (or a filtered view with zero matching
      records) shows a real empty state — not a blank screen, not
      fixture/sample data standing in for "nothing here yet."
- [ ] The empty state suggests the obvious next action (e.g. "Create
      your first bid package"), not just an absence.

## 5. Validation & errors

- [ ] Submitting invalid input produces a clear, specific,
      construction-language error — not a raw database/stack error.
- [ ] A server-side failure (network, RLS rejection, constraint
      violation) is caught and explained, not left as an unhandled
      exception on screen.
- [ ] Required-but-missing prerequisite state (e.g. no fee rule
      configured, no cost codes yet) fails with a clear message
      pointing at the fix, not a generic error.

## 6. Financial correctness (skip if the workspace has no dollar figures)

- [ ] Every dollar figure on screen can be traced to
      `packages/01-financial-engine`'s output — not computed inline by
      the screen.
- [ ] A change made here (entry, commitment, award, etc.) produces the
      correct downstream effect on the project's rolled-up totals,
      confirmed by checking the affected summary screen, not assumed.
- [ ] Money is displayed and entered as whole currency but stored and
      computed as integer cents — no rounding drift visible across a
      few sample transactions.

## 7. Audit history

- [ ] The action just taken produced an audit row (spot-check via
      whatever the current audit-inspection method is).
- [ ] Whoever performed the action is attributed correctly and
      unspoofably (not just a default value a caller could have
      overridden).
- [ ] The current previewer's own role can see the audit history it
      should be able to see, and not more (see §2 — this is where an
      over-broad role, like today's undifferentiated `staff`, would
      surface).

## 8. Navigation & next action

- [ ] From this screen, the path to every related workflow (the
      obvious "where would I go next") is present and makes sense.
- [ ] There is no dead end — every state the user can land in
      (including error and empty states) has an obvious next action.
- [ ] No control exists that looks actionable but silently does
      nothing (a known past defect class in this codebase — dead
      `onClick`-less buttons like the old Selections "Review &
      Approve" and Documents "Download" controls). If a control is
      intentionally not wired yet, it should be visibly disabled, not
      falsely interactive.

## 9. Mobile / responsive (client, vendor, investor, lender screens only)

- [ ] The screen is genuinely usable on a phone-sized viewport, not
      just non-broken — check touch target size, scroll behavior, and
      that nothing critical is cut off.
- [ ] The screen is portrait-first, per the standing design rule.

## 10. Regression

- [ ] `npm run typecheck` / `npm run test` / `npm run build` all pass
      before the preview, and their result is stated (not just
      assumed clean because the branch compiled once earlier).
- [ ] Anything this task touched that has an existing route-smoke or
      SQL-test precedent (e.g. a new admin route, a new RLS policy) has
      matching new coverage, not just a manual check.
- [ ] Nothing outside this task's stated scope changed unexpectedly
      (`git diff` scan for surprises).

---

## Sign-off

- **Package/task previewed:**
- **Role(s) exercised:**
- **Items marked Partial/No, with their named deferral (task/package)
  or fix commit:**
- **Owner decision:** Approved to proceed / Changes requested (list) /
  Blocked pending owner decision on: ______
