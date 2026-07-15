"use client";

import Link from "next/link";

import { cn } from "@/shared/utils/cn";

import { type AppNavItem } from "./appShellNav";
import {
  sidebarCollapsedItemClassName,
  sidebarCollapsedNavClassName,
} from "./sidebarCollapsedLayout";
import { SidebarTooltip } from "./SidebarTooltip";

type AppNavLinksProps = {
  collapsed?: boolean;
  currentPath: string;
  items: AppNavItem[];
  onNavigate?: () => void;
};

export function AppNavLinks({
  collapsed = false,
  currentPath,
  items,
  onNavigate,
}: AppNavLinksProps) {
  return (
    <nav
      aria-label="Navegacion principal"
      className={cn("flex flex-col", collapsed && sidebarCollapsedNavClassName)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.href;

        const link = (
          <Link
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "flex items-center text-sm font-medium text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground",
              "app-sidebar-shell-transition",
              collapsed
                ? sidebarCollapsedItemClassName
                : "gap-3 border-l-4 border-transparent px-5 py-3",
              isActive &&
                (collapsed
                  ? "border-transparent bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  : "border-indigo-300 bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"),
            )}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? undefined : item.label}
          >
            <Icon aria-hidden className="size-5 shrink-0" />
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap app-sidebar-label-transition",
                collapsed ? "max-w-0 opacity-0" : "max-w-[11rem] opacity-100",
              )}
            >
              {item.label}
            </span>
          </Link>
        );

        return (
          <SidebarTooltip
            key={item.href}
            label={item.label}
            placement="bottom"
            show={collapsed}
          >
            {link}
          </SidebarTooltip>
        );
      })}
    </nav>
  );
}
