import { isDemoMode } from "../../src/server/demoMode";
import { requireRole } from "../../src/server/auth/require";

export default async function VendorHoldingPage() {
  if (!isDemoMode()) {
    await requireRole(["vendor"]);
  }

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Vendor Portal</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        The vendor portal is not built yet — you're signed in and authorized as a vendor, but there's no
        vendor-facing content here yet (planned for a later package).
      </p>
    </div>
  );
}
