import { FixtureFinancialRepository } from "../../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { SupabaseFinancialRepository } from "../../../../packages/02-app-shell/src/data/supabaseFinancialRepository";
import type { FinancialRepository } from "../../../../packages/02-app-shell/src/data/financialRepository";
import { isDemoMode } from "../server/demoMode";

let demoRepo: FixtureFinancialRepository | null = null;

/**
 * The hard guard against production silently running on fixtures: this
 * is the only GATED place FixtureFinancialRepository is instantiated,
 * and it only happens when DEMO_MODE is explicitly "true". Every new
 * page.tsx that needs financial data must go through this function,
 * never construct a repository directly. One known, tracked, temporary
 * exception exists outside this gate: apps/web/src/data/loadViewModels.ts
 * still constructs FixtureFinancialRepository unconditionally for every
 * admin/client screen except /admin/financials — see
 * docs/production-build/P1-DESIGN.md §D for why (P1 scope decision,
 * not an oversight) and scripts/check-fixture-boundaries.mjs's
 * CONSTRUCTOR_ALLOWED_PATTERNS for where it's enforced/tracked.
 */
export function getRepository(supabaseClient: unknown): FinancialRepository {
  if (isDemoMode()) {
    if (!demoRepo) demoRepo = new FixtureFinancialRepository();
    return demoRepo;
  }
  return new SupabaseFinancialRepository(supabaseClient);
}
