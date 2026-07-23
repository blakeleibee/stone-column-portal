import { FixtureFinancialRepository } from "../../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { buildAdminFinancialsViewModel } from "../../../../packages/02-app-shell/src/viewmodels/buildAdminFinancialsViewModel";
import { buildClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/buildClientBudgetViewModel";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import type { AdminFinancialsViewModel, ClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";
import type { FinancialRepository } from "../../../../packages/02-app-shell/src/data/financialRepository";

const demoRepo = new FixtureFinancialRepository();

export async function loadAdminVM(): Promise<AdminFinancialsViewModel> {
  return buildAdminFinancialsViewModel(projectMeta.id, demoRepo);
}

export async function loadClientVM(): Promise<ClientBudgetViewModel> {
  return buildClientBudgetViewModel(projectMeta.id, demoRepo);
}

/** Real-repository variant, used only outside DEMO_MODE. Takes an
 *  explicit projectId (no fixture default) and repository instance —
 *  the caller (a page.tsx) is responsible for resolving which project
 *  the current user is viewing and constructing the repository via
 *  getRepository(). */
export async function loadAdminVMFor(projectId: string, repo: FinancialRepository): Promise<AdminFinancialsViewModel> {
  return buildAdminFinancialsViewModel(projectId, repo);
}
