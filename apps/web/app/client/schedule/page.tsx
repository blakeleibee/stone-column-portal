import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ScheduleClientTab } from "../../../src/screens/ScheduleClientTab";

export default function ClientSchedulePage() {
  return (
    <ClientChrome activeKey="schedule">
      <ScheduleClientTab />
    </ClientChrome>
  );
}
