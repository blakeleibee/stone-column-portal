/**
 * Thin re-export of @react-pdf/renderer's `renderToBuffer` (P5 Task 10).
 *
 * `@react-pdf/renderer` is declared as a dependency of THIS package
 * only (packages/02-app-shell) — matching this repo's established
 * convention for a third-party library used exclusively by
 * 02-app-shell code (see csv-parse, which lives only here for the
 * exact same reason, per this task's own correction to the plan).
 *
 * apps/web's Route Handlers (apps/web/app/api/procurement/material-orders/
 * [id]/pdf/route.ts, apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/
 * route.ts) import `renderToBuffer` from HERE, never directly from
 * "@react-pdf/renderer" — a bare npm specifier resolves from the
 * IMPORTING FILE's own node_modules ancestry, not the process entry
 * point's, and apps/web has no node_modules ancestor containing
 * @react-pdf/renderer (it is only installed under
 * packages/02-app-shell/node_modules). Importing it from an apps/web
 * file directly throws `Cannot find module '@react-pdf/renderer'`
 * (verified empirically while wiring these two routes) — routing the
 * import through this module, which itself lives inside
 * packages/02-app-shell and can see that package's own node_modules,
 * is the fix.
 */
export { renderToBuffer } from "@react-pdf/renderer";
