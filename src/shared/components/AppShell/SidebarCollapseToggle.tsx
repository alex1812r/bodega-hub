"use client";

import { Menu } from "lucide-react";

import { cn } from "@/shared/utils/cn";

type SidebarCollapseToggleProps = {
  collapsed: boolean;
  onToggle: () => void;
};

/**
 * Fijo al borde del sidebar; posicion via CSS para animar junto al ancho del panel.
 */
export function SidebarCollapseToggle({ collapsed, onToggle }: SidebarCollapseToggleProps) {
  const label = collapsed ? "Expandir menu" : "Colapsar menu";

  return (
    <button
      aria-expanded={!collapsed}
      aria-label={label}
      className={cn(
        "app-sidebar-toggle fixed z-[70] hidden size-8 cursor-pointer items-center justify-center rounded-full border border-sidebar-foreground/30 bg-sidebar text-sidebar-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 lg:inline-flex",
      )}
      data-collapsed={collapsed ? "true" : "false"}
      onClick={onToggle}
      type="button"
    >
      <Menu aria-hidden className="size-4" />
    </button>
  );
}
