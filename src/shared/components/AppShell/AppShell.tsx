"use client";

import { type ReactNode, useState } from "react";

import {
  getRolePermissions,
  type Permission,
  type UserRole,
} from "@/shared/auth/permissions";

import { cn } from "@/shared/utils/cn";

import { appNavItems } from "./appShellNav";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { SidebarCollapseToggle } from "./SidebarCollapseToggle";
import { useSidebarCollapsed } from "./useSidebarCollapsed";

type AppShellProps = {
  children: ReactNode;
  currentPath?: string;
  mainClassName?: string;
  /** Cuando es `hidden`, el scroll queda en el contenido hijo (p. ej. POS). */
  mainScroll?: "auto" | "hidden";
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
  mainClassName,
  mainScroll = "auto",
  onSignOut,
  permissions,
  refRateError = false,
  refRateVes,
  role,
  userName = "Admin",
  userRole = "Administrador",
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebarCollapsed } =
    useSidebarCollapsed();
  const effectivePermissions =
    permissions ?? (role ? [...getRolePermissions(role)] : []);
  const visibleNavItems = appNavItems.filter((item) =>
    effectivePermissions.includes(item.permission),
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppSidebar
        collapsed={sidebarCollapsed}
        currentPath={currentPath}
        items={visibleNavItems}
        onSignOut={onSignOut}
        userRole={userRole}
      />
      <SidebarCollapseToggle
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebarCollapsed}
      />
      <MobileNavDrawer
        currentPath={currentPath}
        items={visibleNavItems}
        onOpenChange={setMobileNavOpen}
        onSignOut={onSignOut}
        open={mobileNavOpen}
        userRole={userRole}
      />

      <div
        className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      >
        <AppHeader
          className="shrink-0"
          onOpenMenu={() => setMobileNavOpen(true)}
          refRateError={refRateError}
          refRateVes={refRateVes}
          userName={userName}
          userRole={userRole}
        />

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-surface",
            mainScroll === "hidden"
              ? "w-full max-w-none overflow-y-hidden"
              : "overflow-y-auto px-4 py-6 lg:px-6",
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
