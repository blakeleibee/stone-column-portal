import { redirect } from "next/navigation";
import { isDemoMode } from "../src/server/demoMode";
import { getCurrentUser } from "../src/server/auth/getCurrentUser";

export default async function RootPage() {
  if (isDemoMode()) {
    redirect("/admin/overview");
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (user.role === "admin" || user.role === "staff") redirect("/admin/overview");
  if (user.role === "client") redirect("/client/home");
  redirect("/vendor");
}
