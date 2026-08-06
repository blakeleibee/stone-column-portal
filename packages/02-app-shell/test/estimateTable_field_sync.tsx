/**
 * Executable test for /admin/estimate's client-side metadata field sync
 * logic: `useServerSyncedField` in
 * packages/02-app-shell/src/components/EstimateTable.tsx. Run with
 * `npx tsx test/estimateTable_field_sync.tsx`.
 *
 * BACKGROUND: two review rounds found real bugs in this hook that
 * neither of this package's existing tests could have caught.
 * `render_smoke.tsx` uses `renderToStaticMarkup` -- SSR-only, and
 * `useEffect` never runs during SSR -- so it never exercised the
 * resync-on-prop-change path at all. `route_smoke.ts` (apps/web) never
 * requests `/admin/estimate`. The hook's entire reason to exist is what
 * happens on a SECOND render with a changed prop (a router.refresh()
 * bringing fresh server state), which neither test could observe.
 *
 * WHY react-test-renderer (a new devDependency for this package, not
 * previously used anywhere in this repo): asserting "does useEffect
 * actually run and does the DISPLAYED value change on the next render"
 * requires a renderer that commits and runs effects -- renderToStaticMarkup
 * cannot do this by design. react-test-renderer is React's own official
 * package for exactly this case (Node-only, no DOM/jsdom required),
 * pinned to the same 18.3.1 version already used for react/react-dom in
 * this package. This is a disclosed, deliberate departure from the
 * "plain assert, no framework" style used elsewhere in this repo's
 * tests -- flagged here rather than added silently, per the task's
 * instructions -- because effect-timing bugs like the one this file
 * exists to catch cannot be asserted any other way in this codebase's
 * existing test conventions.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { resolveResyncedFieldValue, useServerSyncedField } from "../src/components/EstimateTable";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

// =====================================================================
// Architecture (source-text) check: the exact regression class a prior
// review round found -- reading the mutable `lastServerValueRef.current`
// LIVE from inside the `setValue` functional updater -- is, empirically,
// NOT reliably caught by the react-test-renderer integration tests below
// (confirmed by hand: react-test-renderer's legacy update flushing
// invokes a functional updater synchronously, which happens to mask the
// exact React-18-automatic-batching timing the original bug depended
// on). Since the pure-function tests above only test the extracted
// resolveResyncedFieldValue() in isolation and can't observe whether the
// HOOK actually calls it with a properly captured argument vs. a live
// ref read, this source-level check closes that specific gap directly
// -- mirroring render_smoke.tsx's existing convention (in this same
// package) of asserting source-level invariants via plain string checks
// where a runtime assertion can't reach.
// =====================================================================
console.log("--- Architecture: the resync updater must never read the mutable ref live ---");
{
  const source = fs.readFileSync(path.join(__dirname, "../src/components/EstimateTable.tsx"), "utf8");
  const hookStart = source.indexOf("export function useServerSyncedField");
  check("found useServerSyncedField in EstimateTable.tsx", hookStart !== -1);
  const hookEnd = source.indexOf("\nexport interface EstimateTableProps", hookStart);
  check("found the end boundary of useServerSyncedField", hookStart !== -1 && hookEnd !== -1);
  const hookSource = hookStart !== -1 && hookEnd !== -1 ? source.slice(hookStart, hookEnd) : "";

  const updaterMatch = hookSource.match(/setValue\(\(current\) => ([^;]*)\);/);
  check("found the setValue functional updater call inside the resync effect", !!updaterMatch);
  const updaterBody = updaterMatch ? updaterMatch[1] : "<not found>";
  check(
    "the updater closes over a captured variable, NOT a live read of lastServerValueRef.current (the exact round-2 regression)",
    !updaterBody.includes("lastServerValueRef.current") && updaterBody.includes("resolveResyncedFieldValue")
  );
}

// =====================================================================
// Pure-function tests for resolveResyncedFieldValue -- deliberately NOT
// going through React/react-test-renderer at all. A prior attempt at
// this test round used ONLY a react-test-renderer mount+update to prove
// the resync fix, and that test passed against BOTH the fixed code and
// a deliberately-reintroduced buggy version (confirmed by manually
// re-injecting the exact bug from the previous round and re-running --
// see the fix report for the full trace). The reason: react-test-
// renderer's legacy (non-concurrent-root) update flushing happens to
// invoke a functional setValue updater SYNCHRONOUSLY, immediately at
// the call site -- the opposite of React 18 automatic batching's
// deferred-updater timing that the real bug depended on, which is what
// this component actually runs under in the real Next.js/browser
// runtime. That makes react-test-renderer an unreliable way to prove
// this SPECIFIC ordering fix -- so this exact invariant is verified
// here directly and deterministically, independent of any renderer's
// internal scheduling choices, by testing the pure decision function
// itself and by mechanically reproducing the old bug's logic inline for
// contrast.
// =====================================================================
console.log("--- resolveResyncedFieldValue: pure-function, scheduler-independent correctness ---");
{
  // Clean field: current still equals the captured previous baseline ->
  // adopt the new server value.
  check(
    "clean field resolves to the new server value",
    resolveResyncedFieldValue("A", "A", "B") === "B"
  );
  // Dirty field: current has already diverged from the captured previous
  // baseline (an in-progress local edit) -> keep the local value, do not
  // stomp it.
  check(
    "dirty field keeps its current (unsaved) value",
    resolveResyncedFieldValue("A-edited", "A", "B") === "A-edited"
  );
  // Works for booleans (includeInEstimate / billable) too.
  check(
    "clean boolean field resolves to the new server value",
    resolveResyncedFieldValue(true, true, false) === false
  );
}

console.log("\n--- Mechanical reproduction of the round-2 ordering bug, for direct contrast ---");
{
  // This inlines EXACTLY what the buggy version did: instead of an
  // explicitly captured `previousServerValue` argument, it read the
  // mutable ref's CURRENT value at whatever moment the updater actually
  // ran. Under React 18 automatic batching, that moment is AFTER the
  // effect body's own `lastServerValueRef.current = serverValue` line
  // has already executed -- so by the time the updater runs, the "old
  // baseline" it reads has already become the NEW value. Simulating
  // that exact interleaving here (refAtUpdaterTime already advanced to
  // the new value) proves the old logic was broken independent of any
  // particular renderer's timing, and that resolveResyncedFieldValue's
  // explicit-argument design is what actually fixes it.
  function buggyResolveReadingLiveRef<T>(current: T, refValueAtUpdaterTime: T, nextServerValue: T): T {
    return Object.is(current, refValueAtUpdaterTime) ? nextServerValue : current;
  }

  const current = "A";
  const nextServerValue = "B";
  const refValueAfterMutation = "B"; // lastServerValueRef.current, already advanced by the time the updater ran

  check(
    "the OLD (buggy) logic, given the ref already mutated before the updater runs, incorrectly stays stale",
    buggyResolveReadingLiveRef(current, refValueAfterMutation, nextServerValue) === "A"
  );
  check(
    "the FIXED logic (resolveResyncedFieldValue), given the correctly-captured pre-mutation baseline, resolves to the new value",
    resolveResyncedFieldValue(current, "A" /* captured BEFORE the ref was mutated */, nextServerValue) === "B"
  );
}

// =====================================================================
// React-level integration tests below: these exercise useServerSyncedField
// through an actual mount via react-test-renderer. They prove the
// hook's overall WIRING and CONTRACT (dirty-protection, revert-on-error,
// markSaved chaining) end to end, and they DO regress-guard against
// gross mistakes (e.g. forgetting to call setValue at all, wiring the
// wrong prop). What they do NOT reliably prove is the specific
// updater-vs-ref ordering fixed above -- see the disclosed limitation in
// the block comment right above this one; that invariant is proven by
// the scheduler-independent pure-function tests instead.
// =====================================================================
type FieldControls<T> = ReturnType<typeof useServerSyncedField<T>>;

/** Exposes the hook's live return value to the test via a mutable
 *  capture object, updated on every render -- avoids pulling in any DOM
 *  query library (no @testing-library) just to read a value back out. */
function Harness<T>({
  serverValue,
  capture,
}: {
  serverValue: T;
  capture: { current: FieldControls<T> | null };
}) {
  const field = useServerSyncedField(serverValue);
  capture.current = field;
  return null;
}

function renderHarness<T>(serverValue: T) {
  const capture: { current: FieldControls<T> | null } = { current: null };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness serverValue={serverValue} capture={capture} />);
  });
  return {
    capture,
    update(nextServerValue: T) {
      act(() => {
        renderer.update(<Harness serverValue={nextServerValue} capture={capture} />);
      });
    },
  };
}

console.log("--- useServerSyncedField: a clean (untouched) field resyncs when the server value changes ---");
{
  // This is the exact scenario a prior review round found broken: the
  // resync effect's own ordering bug (mutating the ref before React had
  // actually applied the functional setValue update) made this silently
  // no-op instead of updating the displayed value.
  const { capture, update } = renderHarness<string>("A");
  check("initial value seeded from the server value", capture.current!.value === "A");
  update("B");
  check(
    "clean field resyncs to the new server value after an external (router.refresh()-style) change",
    capture.current!.value === "B"
  );
}

console.log("\n--- useServerSyncedField: an in-progress local edit is never stomped by an unrelated server value change ---");
{
  const { capture, update } = renderHarness<string>("A");
  act(() => {
    capture.current!.setValue("A-edited");
  });
  check("local edit applied", capture.current!.value === "A-edited");
  update("B");
  check(
    "dirty field keeps the in-progress, not-yet-saved edit -- it is NOT overwritten by a concurrent server value",
    capture.current!.value === "A-edited"
  );
}

console.log("\n--- useServerSyncedField: revertToServerValue() undoes an optimistic update after a rejected save ---");
{
  const { capture } = renderHarness<string>("A");
  act(() => {
    capture.current!.setValue("A-optimistic");
  });
  check("optimistic value applied before the server responds", capture.current!.value === "A-optimistic");
  act(() => {
    capture.current!.revertToServerValue();
  });
  check(
    "value snaps back to the last server-confirmed baseline after a rejected save (Finding 1)",
    capture.current!.value === "A"
  );
}

console.log("\n--- useServerSyncedField: markSaved() advances the baseline, and later independent server changes still resync correctly ---");
{
  const { capture, update } = renderHarness<string>("A");
  act(() => {
    capture.current!.setValue("A-committed");
  });
  act(() => {
    capture.current!.markSaved("A-committed");
  });
  check("markSaved keeps the just-saved value in place", capture.current!.value === "A-committed");

  // Simulate router.refresh() bringing back exactly what this row just
  // saved -- must be a no-op, not a flicker.
  update("A-committed");
  check(
    "no flicker when the refreshed prop matches what was just committed",
    capture.current!.value === "A-committed"
  );

  // Simulate the server having normalized the saved value differently
  // (e.g. trimmed whitespace) -- the field is NOT dirty relative to the
  // new baseline, so it must still resync to the real server value.
  update("A-normalized-by-server");
  check(
    "field resyncs to a server-normalized value when it is not dirty relative to the current baseline",
    capture.current!.value === "A-normalized-by-server"
  );
}

console.log("\n--- useServerSyncedField: works identically for boolean fields (includeInEstimate / billable) ---");
{
  const { capture, update } = renderHarness<boolean>(true);
  check("initial boolean value seeded from the server value", capture.current!.value === true);
  update(false);
  check("clean boolean field resyncs to the new server value", capture.current!.value === false);

  act(() => {
    capture.current!.setValue(true);
  });
  act(() => {
    capture.current!.revertToServerValue();
  });
  check("boolean field reverts to the last confirmed baseline after a rejected save", capture.current!.value === false);
}

console.log(`\nestimateTable_field_sync.tsx: all ${checks} checks passed.`);
