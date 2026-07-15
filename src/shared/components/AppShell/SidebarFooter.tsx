import { LogOut } from "lucide-react";

import { cn } from "@/shared/utils/cn";

import {
  sidebarCollapsedGutterClassName,
  sidebarCollapsedItemClassName,
} from "./sidebarCollapsedLayout";
import { SidebarTooltip } from "./SidebarTooltip";

type SidebarFooterProps = {
  collapsed?: boolean;
  onSignOut?: () => void;
};

export function SidebarFooter({ collapsed = false, onSignOut }: SidebarFooterProps) {
  if (!onSignOut) {
    return null;
  }

  return (
    <div
      className={cn(
        "border-t border-sidebar-foreground/20 app-sidebar-shell-transition",
        sidebarCollapsedGutterClassName,
        collapsed ? "py-2" : "p-4",
      )}
    >
      <SidebarTooltip label="Cerrar sesion" placement="bottom" show={collapsed}>
        <button
          aria-label="Cerrar sesion"
          className={cn(
            "flex w-full cursor-pointer items-center rounded-lg text-sm font-medium text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
            "app-sidebar-shell-transition",
            collapsed ? sidebarCollapsedItemClassName : "gap-3 px-3 py-2",
          )}
          onClick={onSignOut}
          type="button"
        >
          <LogOut aria-hidden className="size-5 shrink-0" />
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap app-sidebar-label-transition",
              collapsed ? "max-w-0 opacity-0" : "max-w-[11rem] opacity-100",
            )}
          >
            Cerrar sesion
          </span>
        </button>
      </SidebarTooltip>
    </div>
  );
}
