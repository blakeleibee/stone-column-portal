// Shared source of truth for issued-document PDF template versions
// (Decision 4, Revision 3). Lives in its own tiny module, imported by
// BOTH documentIssuanceService.ts (this task) and the actual PDF
// template components (Task 10, not yet built) — Task 10's components
// are created after this task in the plan's own sequence, so a forward
// import from the service into Task 10's files would break this task's
// typecheck until Task 10 exists. A single shared module avoids the
// ordering problem entirely and guarantees the service and the
// templates can never silently declare two different version strings
// for the same template.
export const MATERIAL_ORDER_PDF_TEMPLATE_VERSION = "1";
export const SUBCONTRACT_PDF_TEMPLATE_VERSION = "1";
