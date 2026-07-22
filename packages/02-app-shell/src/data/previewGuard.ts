/**
 * CORRECTION (Package 2 review item 7): the required preview flow is:
 *   - Admin stays authenticated as admin (no role switch on the auth
 *     session itself)
 *   - Admin selects a specific project/client to preview
 *   - Data is fetched through the SAME client-safe view-model path a
 *     real client would use (buildClientBudgetViewModel + the
 *     client-safe repository methods) — not the admin fixture/view
 *     model with fields hidden after the fact
 *   - Approvals and other client-mutating actions are BLOCKED while
 *     previewing
 *   - A persistent banner is shown, with an obvious Exit control
 *
 * Package 2 has no mutation-triggering UI yet (Financials is read-only
 * in this package) — so there is nothing to test this guard against
 * today. It's written now, as a small, explicit function every future
 * mutating action must call first, so Package 3+ can't accidentally
 * ship an approve/edit button that works during a client preview
 * simply because nobody remembered to check.
 */
export class PreviewModeMutationBlockedError extends Error {
  constructor(action: string) {
    super(`"${action}" is not permitted while previewing as a client. Exit preview to perform this action.`);
    this.name = "PreviewModeMutationBlockedError";
  }
}

/** Call this at the start of every mutation handler (approve a
 *  suggestion, edit an expense, sign a change order, etc.) — pass the
 *  current preview state and a human-readable action name. Throws if
 *  currently previewing; does nothing otherwise. */
export function assertNotPreviewing(isPreviewingAsClient: boolean, action: string): void {
  if (isPreviewingAsClient) {
    throw new PreviewModeMutationBlockedError(action);
  }
}
