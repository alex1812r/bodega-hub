import type { UserRole } from "./permissions";

export function getDefaultHomePathForRole(role: UserRole): string {
  if (role === "vendedor") {
    return "/sales/create";
  }

  return "/dashboard";
}
