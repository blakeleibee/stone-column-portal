"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "../../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "../demo/DemoControls";
import { SampleDataTag } from "../components/SampleDataTag";

const CLIENT_PATH: Record<string, string> = {
  home: "/client/home",
  budget: "/client/budget",
  schedule: "/client/schedule",
  selections: "/client/selections",
  messages: "/client/messages",
  updates: "/client/updates",
  documents: "/client/documents",
};

const ADMIN_OVERVIEW_PATH = "/admin/overview";

export function ClientChrome({ activeKey, children }: { activeKey: string; children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreviewingAsClient = searchParams.get("preview") === "1";
  const clientUserName = (projectMeta.clientNames ?? "Client").split(" & ")[0];

  function handleNavigate(key: string) {
    const path = CLIENT_PATH[key];
    if (!path) return;
    router.push(isPreviewingAsClient ? `${path}?preview=1` : path);
  }

  function handleChangeRole(role: AppRole) {
    if (role === "client") {
      if (isPreviewingAsClient) {
        router.push(CLIENT_PATH[activeKey] ?? CLIENT_PATH.home);
      }
      // else: already a genuine client view, no-op — matches the
      // original in-memory behavior of clicking the already-active role.
    } else {
      router.push(ADMIN_OVERVIEW_PATH);
    }
  }

  function handlePreviewAsClient() {
    router.push(`${CLIENT_PATH.budget}?preview=1`);
  }

  function handleExitPreview() {
    router.push(ADMIN_OVERVIEW_PATH);
  }

  return (
    <div>
      <DemoControls
        role="client"
        onChangeRole={handleChangeRole}
        isPreviewingAsClient={isPreviewingAsClient}
        onPreviewAsClient={handlePreviewAsClient}
      />
      <AppShell
        role="client"
        activeKey={activeKey}
        onNavigate={handleNavigate}
        userName={clientUserName}
        isPreviewingAsClient={isPreviewingAsClient}
        onExitPreview={handleExitPreview}
      >
        <SampleDataTag />
        {children}
      </AppShell>
    </div>
  );
}
