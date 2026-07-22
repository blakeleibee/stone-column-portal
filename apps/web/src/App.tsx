import React, { useEffect, useState } from "react";
import { AppShell } from "../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../packages/02-app-shell/src/nav/navigation";
import { FixtureFinancialRepository } from "../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { buildAdminFinancialsViewModel } from "../../../packages/02-app-shell/src/viewmodels/buildAdminFinancialsViewModel";
import { buildClientBudgetViewModel } from "../../../packages/02-app-shell/src/viewmodels/buildClientBudgetViewModel";
import type { AdminFinancialsViewModel, ClientBudgetViewModel } from "../../../packages/02-app-shell/src/viewmodels/types";
import { projectMeta } from "../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "./demo/DemoControls";
import { AdminOverviewScreen } from "./screens/AdminOverviewScreen";
import { ProjectWorkspace, SelectionsTab, DocumentsTab, UpdatesTab, ConversationsTab } from "./screens/ProjectWorkspace";
import { ClientHomeScreen } from "./screens/ClientHomeScreen";
import { ClientBudgetAndInvoicesScreen } from "../../../packages/02-app-shell/src/screens/ClientBudgetAndInvoicesScreen";
import { ActionCenterScreen } from "./screens/ActionCenterScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { ScheduleClientTab } from "./screens/ScheduleClientTab";
import { SampleDataTag } from "./components/SampleDataTag";

export type AdminActiveKey = "overview" | "projects" | "action-center" | "financials" | "conversations" | "contacts" | "settings";
export type ClientActiveKey = "home" | "budget" | "schedule" | "selections" | "messages" | "updates" | "documents";

const repo = new FixtureFinancialRepository();

export function App() {
  const [role, setRole] = useState<AppRole>("admin");
  const [isPreviewingAsClient, setIsPreviewingAsClient] = useState(false);
  const [adminActiveKey, setAdminActiveKey] = useState<AdminActiveKey>("overview");
  const [clientActiveKey, setClientActiveKey] = useState<ClientActiveKey>("home");

  const [adminVM, setAdminVM] = useState<AdminFinancialsViewModel | null>(null);
  const [clientVM, setClientVM] = useState<ClientBudgetViewModel | null>(null);

  useEffect(() => {
    buildAdminFinancialsViewModel(projectMeta.id, repo).then(setAdminVM);
    buildClientBudgetViewModel(projectMeta.id, repo).then(setClientVM);
  }, []);

  const effectiveRole: AppRole = isPreviewingAsClient ? "client" : role;
  const effectiveActiveKey = effectiveRole === "client" ? clientActiveKey : adminActiveKey;

  function handleNavigate(key: string) {
    if (effectiveRole === "client") {
      setClientActiveKey(key as ClientActiveKey);
    } else {
      setAdminActiveKey(key as AdminActiveKey);
    }
  }

  if (!adminVM || !clientVM) {
    return <div style={{ padding: 32, fontFamily: "sans-serif", color: "#8B7F6C" }}>Loading sample data…</div>;
  }

  return (
    <div>
      <DemoControls
        role={role}
        onChangeRole={(r) => {
          setRole(r);
          setIsPreviewingAsClient(false);
        }}
        isPreviewingAsClient={isPreviewingAsClient}
        onPreviewAsClient={() => {
          setIsPreviewingAsClient(true);
          setClientActiveKey("budget");
        }}
      />

      <AppShell
        role={effectiveRole}
        activeKey={effectiveActiveKey}
        onNavigate={handleNavigate}
        userName={
          effectiveRole === "client"
            ? (projectMeta.clientNames ?? "Client").split(" & ")[0]
            : role === "admin"
              ? "Brent Leibee"
              : "Staff Member"
        }
        projectName={effectiveRole !== "client" ? projectMeta.name : undefined}
        isPreviewingAsClient={isPreviewingAsClient}
        onExitPreview={() => setIsPreviewingAsClient(false)}
      >
        <SampleDataTag />
        {effectiveRole === "client" ? (
          <ClientContent activeKey={clientActiveKey} clientVM={clientVM} onGoToBudget={() => setClientActiveKey("budget")} />
        ) : (
          <AdminContent activeKey={adminActiveKey} adminVM={adminVM} onOpenProject={() => setAdminActiveKey("projects")} />
        )}
      </AppShell>
    </div>
  );
}

export function AdminContent({
  activeKey,
  adminVM,
  onOpenProject,
}: {
  activeKey: AdminActiveKey;
  adminVM: AdminFinancialsViewModel;
  onOpenProject: () => void;
}) {
  switch (activeKey) {
    case "overview":
      return <AdminOverviewScreen onOpenProject={onOpenProject} adminVM={adminVM} />;
    case "projects":
      return <ProjectWorkspace adminViewModel={adminVM} />;
    case "financials":
      return <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" />;
    case "action-center":
      return <ActionCenterScreen />;
    case "conversations":
      return <ConversationsTab />;
    case "contacts":
      return <ContactsScreen />;
    case "settings":
      return (
        <PlaceholderScreen
          title="Settings"
          description="Company profile, user management, cost-code library, and notification preferences."
          packageLabel="later package"
        />
      );
  }
}

export function ClientContent({
  activeKey,
  clientVM,
  onGoToBudget,
}: {
  activeKey: ClientActiveKey;
  clientVM: ClientBudgetViewModel;
  onGoToBudget: () => void;
}) {
  switch (activeKey) {
    case "home":
      return <ClientHomeScreen onGoToBudget={onGoToBudget} clientVM={clientVM} />;
    case "budget":
      return <ClientBudgetAndInvoicesScreen viewModel={clientVM} />;
    case "schedule":
      return <ScheduleClientTab />;
    case "selections":
      return <SelectionsTab isClient />;
    case "messages":
      return <ConversationsTab />;
    case "updates":
      return <UpdatesTab isClient />;
    case "documents":
      return <DocumentsTab isClient />;
  }
}
