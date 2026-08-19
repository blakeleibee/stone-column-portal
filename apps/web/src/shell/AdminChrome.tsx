"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, type AppShellProjectSwitcherProps } from "../../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "../demo/DemoControls";
import { SampleDataTag } from "../components/SampleDataTag";
import { getProjectSwitcherData } from "../server/project/switcherDataAction";
import { switchProject } from "../../app/admin/projects/switchAction";

const ADMIN_PATH: Record<string, string> = {
  overview: "/admin/overview",
  projects: "/admin/projects",
  "action-center": "/admin/action-center",
  financials: "/admin/financials",
  estimate: "/admin/estimate",
  import: "/admin/import",
  bids: "/admin/bids",
  conversations: "/admin/conversations",
  contacts: "/admin/contacts",
  settings: "/admin/settings",
};

const CLIENT_HOME_PATH = "/client/home";
const CLIENT_PREVIEW_PATH = "/client/budget?preview=1";

export function AdminChrome({
  activeKey,
  isDemoMode,
  children,
}: {
  activeKey: string;
  isDemoMode: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [subRole, setSubRole] = useState<"admin" | "staff">("admin");

  // Task 4's ProjectSwitcher data. `null` = not yet loaded / unavailable
  // (demo mode, no session, or a real session with a non-admin/staff
  // role) — AppShell simply omits the switcher and falls back to the
  // old plain `projectName` text in that case (see AppShell.tsx's
  // `projectSwitcher` prop doc comment). Fetched client-side here
  // (rather than threaded down from each page.tsx as a prop) because
  // AdminChrome is the one shared call site for every admin page's
  // <AppShell>, and this task is scoped to NOT touch those other
  // pages' own Server Component data-loading (Task 5's job) — see the
  // Task 4 report's Judgment calls section.
  const [switcherData, setSwitcherData] = useState<Omit<AppShellProjectSwitcherProps, "onSwitch" | "allProjectsHref" | "archivedProjectsHref" | "createProjectHref"> | null>(null);

  const loadSwitcherData = useCallback(async () => {
    if (isDemoMode) {
      setSwitcherData(null);
      return;
    }
    const result = await getProjectSwitcherData();
    if ("error" in result) {
      setSwitcherData(null);
      return;
    }
    setSwitcherData(result);
  }, [isDemoMode]);

  useEffect(() => {
    loadSwitcherData();
  }, [loadSwitcherData]);

  async function handleSwitchProject(projectId: string) {
    const result = await switchProject(projectId);
    if (!("error" in result)) {
      await loadSwitcherData();
      router.refresh();
    }
    return result;
  }

  function handleNavigate(key: string) {
    const path = ADMIN_PATH[key];
    if (path) router.push(path);
  }

  function handleChangeRole(role: AppRole) {
    if (role === "client") {
      router.push(CLIENT_HOME_PATH);
    } else {
      setSubRole(role);
    }
  }

  function handlePreviewAsClient() {
    router.push(CLIENT_PREVIEW_PATH);
  }

  return (
    <div>
      {isDemoMode && (
        <DemoControls
          role={subRole}
          onChangeRole={handleChangeRole}
          isPreviewingAsClient={false}
          onPreviewAsClient={handlePreviewAsClient}
        />
      )}
      <AppShell
        role={subRole}
        activeKey={activeKey}
        onNavigate={handleNavigate}
        userName={subRole === "admin" ? "Brent Leibee" : "Staff Member"}
        // The fixture project name is only meaningful in demo mode; in a
        // real session it's replaced by the real ProjectSwitcher below
        // (previously this was passed unconditionally, which is the
        // exact "renders the fixture project regardless of DEMO_MODE"
        // bug this task's brief flagged for /admin/projects's old stub —
        // fixed here too since AdminChrome is the one shared place every
        // admin page's header comes from).
        projectName={isDemoMode ? projectMeta.name : undefined}
        projectSwitcher={
          switcherData
            ? {
                ...switcherData,
                onSwitch: handleSwitchProject,
                allProjectsHref: "/admin/projects",
                archivedProjectsHref: "/admin/projects?view=archived",
                createProjectHref: "/admin/projects?new=1",
              }
            : undefined
        }
      >
        {isDemoMode && <SampleDataTag />}
        {children}
      </AppShell>
    </div>
  );
}
