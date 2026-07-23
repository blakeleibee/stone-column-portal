export type AppRole = "admin" | "staff" | "client" | "vendor";

export interface AppUser {
  id: string;
  orgId: string;
  role: AppRole;
  fullName: string;
  email: string;
  isActive: boolean;
}
