import type { UserRole } from "./permissions";

export function getDefaultHomePathForRole(role: UserRole): string {
  if (role === "superadmin") {
    return "/platform/dashboard";
  }

  if (role === "vendedor") {
    return "/sales/create";
  }

  return "/dashboard";
}
