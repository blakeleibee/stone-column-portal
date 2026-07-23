import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ScheduleClientTab } from "../../../src/screens/ScheduleClientTab";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientSchedulePage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  return (
    <ClientChrome activeKey="schedule" isDemoMode={isDemoMode()}>
      <ScheduleClientTab />
    </ClientChrome>
  );
}
