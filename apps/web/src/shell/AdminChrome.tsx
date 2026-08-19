"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, type AppShellProjectSwitcherProps } from "../../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "../demo/DemoControls";
import { SampleDataTag } from "../components/SampleDataTag";
import { getProjectSwitcherData, type ProjectSwitcherData } from "../server/project/switcherDataAction";
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
  projectSwitcherData,
}: {
  activeKey: string;
  isDemoMode: boolean;
  children: React.ReactNode;
  /**
   * Task 5: optional server-resolved switcher data, passed by pages that
   * already called resolveSelectedProject() + listAccessibleProjects()
   * for their own content (via resolveProjectAndSwitcherData()) — reuses
   * that data instead of AdminChrome firing its own client-side
   * getProjectSwitcherData() round trip on every mount. This is what
   * closes the Task 4 review finding that the header visibly blanks out
   * and reloads on every admin-to-admin navigation: with this prop
   * present, the switcher renders synchronously from the server-rendered
   * prop on first paint instead of `null` → fetch → data.
   *
   * Deliberately three-state, not two: `undefined` (prop omitted
   * entirely) means "this caller hasn't been migrated yet" and falls
   * back to the original client-side fetch below, unchanged — additive,
   * backward-compatible. `null` is a real value a migrated caller can
   * pass (mirrors getProjectSwitcherData()'s own error/non-admin-role
   * return), meaning "server already resolved this, and the answer is
   * no switcher" — that also must NOT trigger the client-side fetch.
   * Only `=== undefined` distinguishes "not migrated" from "migrated,
   * resolved to nothing."
   */
  projectSwitcherData?: ProjectSwitcherData | null;
}) {
  const router = useRouter();
  const [subRole, setSubRole] = useState<"admin" | "staff">("admin");
  const hasServerSwitcherData = projectSwitcherData !== undefined;

  // Task 4's ProjectSwitcher data, fetched client-side. `null` = not yet
  // loaded / unavailable (demo mode, no session, or a real session with
  // a non-admin/staff role) — AppShell simply omits the switcher and
  // falls back to the old plain `projectName` text in that case (see
  // AppShell.tsx's `projectSwitcher` prop doc comment). This remains the
  // fallback path for any admin page not yet passing
  // `projectSwitcherData` (Task 5 only rewires overview/financials/
  // estimate/bids/import) and for demo mode, which is unaffected.
  const [clientSwitcherData, setClientSwitcherData] = useState<Omit<AppShellProjectSwitcherProps, "onSwitch" | "allProjectsHref" | "archivedProjectsHref" | "createProjectHref"> | null>(null);

  const loadSwitcherData = useCallback(async () => {
    if (isDemoMode || hasServerSwitcherData) {
      setClientSwitcherData(null);
      return;
    }
    const result = await getProjectSwitcherData();
    if ("error" in result) {
      setClientSwitcherData(null);
      return;
    }
    setClientSwitcherData(result);
  }, [isDemoMode, hasServerSwitcherData]);

  useEffect(() => {
    loadSwitcherData();
  }, [loadSwitcherData]);

  // Server-resolved data wins whenever the caller supplied it at all
  // (including an explicit `null`) — see the prop's doc comment above
  // for why `undefined` is the only "not migrated" signal.
  const switcherData = hasServerSwitcherData ? projectSwitcherData : clientSwitcherData;

  async function handleSwitchProject(projectId: string) {
    const result = await switchProject(projectId);
    if (!("error" in result)) {
      // Server-resolved callers get fresh switcher data for free from
      // router.refresh() re-rendering the page.tsx Server Component (and
      // therefore this prop) — re-running the client-side fetch too
      // would be a redundant round trip. Client-fetch callers still need
      // the explicit reload, same as before Task 5.
      if (!hasServerSwitcherData) {
        await loadSwitcherData();
      }
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
