"use client";

import { type ReactNode } from "react";

import { type Permission } from "./permissions";
import { usePermission } from "./usePermission";

type CanProps = {
  children: ReactNode;
  fallback?: ReactNode;
  permission: Permission;
};

export function Can({ children, fallback = null, permission }: CanProps) {
  const { can, isLoading } = usePermission();

  if (isLoading) {
    return null;
  }

  return can(permission) ? children : fallback;
}
