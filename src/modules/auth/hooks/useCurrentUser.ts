"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";
import type { Permission, UserRole } from "@/shared/auth/permissions";

export type CurrentUser = {
  email?: string;
  id: string;
  isActive: boolean;
  name: string;
};

export type CurrentUserResponse = {
  deniedPermissions: Permission[];
  grantedPermissions: Permission[];
  permissionCatalog: Permission[];
  permissions: Permission[];
  role: UserRole;
  roles: UserRole[];
  user: CurrentUser;
};

export const authQueryKeys = {
  all: ["auth"] as const,
  me: () => [...authQueryKeys.all, "me"] as const,
};

export function useCurrentUser() {
  return useQuery({
    queryKey: authQueryKeys.me(),
    queryFn: () => apiFetch<CurrentUserResponse>("/api/auth/me"),
  });
}
