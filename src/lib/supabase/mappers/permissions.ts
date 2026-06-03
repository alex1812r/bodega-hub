import { isPermission, type Permission } from "@/shared/auth/permissions";

export function mapPermissionList(value: unknown): Permission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPermission);
}
