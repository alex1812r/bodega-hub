"use client";

import { type ReactNode, useState } from "react";

import {
  getRolePermissions,
  type Permission,
  type UserRole,
} from "@/shared/auth/permissions";

import { appNavItems } from "./appShellNav";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { MobileNavDrawer } from "./MobileNavDrawer";

type AppShellProps = {
  children: ReactNode;
  currentPath?: string;
  onSignOut?: () => void;
  permissions?: readonly Permission[];
  refRateError?: boolean;
  refRateVes?: number;
  role?: UserRole;
  userName?: string;
  userRole?: string;
};

export function AppShell({
  children,
  currentPath = "/dashboard",
  onSignOut,
  permissions,
  refRateError = false,
  refRateVes,
  role,
  userName = "Admin",
  userRole = "admin",
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const effectivePermissions =
    permissions ?? (role ? [...getRolePermissions(role)] : []);
  const visibleNavItems = appNavItems.filter((item) =>
    effectivePermissions.includes(item.permission),
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <AppSidebar currentPath={currentPath} items={visibleNavItems} />
      <MobileNavDrawer
        currentPath={currentPath}
        items={visibleNavItems}
        onOpenChange={setMobileNavOpen}
        open={mobileNavOpen}
      />

      <div className="min-w-0 lg:pl-72">
        <AppHeader
          onOpenMenu={() => setMobileNavOpen(true)}
          onSignOut={onSignOut}
          refRateError={refRateError}
          refRateVes={refRateVes}
          userName={userName}
          userRole={userRole}
        />

        <main className="min-w-0 max-w-full px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
