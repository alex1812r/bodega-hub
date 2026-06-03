"use client";

import { useMemo } from "react";

import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";

import { type Permission } from "./permissions";

export function usePermission() {
  const currentUser = useCurrentUser();

  return useMemo(() => {
    const permissions = currentUser.data?.permissions ?? [];

    return {
      can: (permission: Permission) => permissions.includes(permission),
      isLoading: currentUser.isLoading,
      permissions,
      profile: currentUser.data,
      role: currentUser.data?.role,
      user: currentUser.data?.user,
    };
  }, [currentUser.data, currentUser.isLoading]);
}
