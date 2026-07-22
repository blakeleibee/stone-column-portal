import { FixtureFinancialRepository } from "../../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { buildAdminFinancialsViewModel } from "../../../../packages/02-app-shell/src/viewmodels/buildAdminFinancialsViewModel";
import { buildClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/buildClientBudgetViewModel";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import type { AdminFinancialsViewModel, ClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";

const repo = new FixtureFinancialRepository();

export async function loadAdminVM(): Promise<AdminFinancialsViewModel> {
  return buildAdminFinancialsViewModel(projectMeta.id, repo);
}

export async function loadClientVM(): Promise<ClientBudgetViewModel> {
  return buildClientBudgetViewModel(projectMeta.id, repo);
}
