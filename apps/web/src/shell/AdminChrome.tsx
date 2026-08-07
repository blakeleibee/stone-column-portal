"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "../demo/DemoControls";
import { SampleDataTag } from "../components/SampleDataTag";

const ADMIN_PATH: Record<string, string> = {
  overview: "/admin/overview",
  projects: "/admin/projects",
  "action-center": "/admin/action-center",
  financials: "/admin/financials",
  estimate: "/admin/estimate",
  import: "/admin/import",
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
        projectName={projectMeta.name}
      >
        {isDemoMode && <SampleDataTag />}
        {children}
      </AppShell>
    </div>
  );
}
