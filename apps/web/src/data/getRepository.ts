import { FixtureFinancialRepository } from "../../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { SupabaseFinancialRepository } from "../../../../packages/02-app-shell/src/data/supabaseFinancialRepository";
import type { FinancialRepository } from "../../../../packages/02-app-shell/src/data/financialRepository";
import { isDemoMode } from "../server/demoMode";

let demoRepo: FixtureFinancialRepository | null = null;

/**
 * The hard guard against production silently running on fixtures: this
 * is the ONLY place FixtureFinancialRepository is ever instantiated
 * outside a test file, and it only happens when DEMO_MODE is
 * explicitly "true". Every page.tsx that needs financial data must go
 * through this function, never construct a repository directly.
 */
export function getRepository(supabaseClient: unknown): FinancialRepository {
  if (isDemoMode()) {
    if (!demoRepo) demoRepo = new FixtureFinancialRepository();
    return demoRepo;
  }
  return new SupabaseFinancialRepository(supabaseClient);
}
