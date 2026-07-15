import { Store, X } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

import {
  sidebarCollapsedGutterClassName,
  sidebarCollapsedItemClassName,
} from "./sidebarCollapsedLayout";

type SidebarBrandProps = {
  collapsed?: boolean;
  onClose?: () => void;
  userRole?: string;
};

export function SidebarBrand({
  collapsed = false,
  onClose,
  userRole = "Administrador",
}: SidebarBrandProps) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border-b border-sidebar-foreground/20",
        sidebarCollapsedGutterClassName,
        "app-sidebar-shell-transition py-2",
        !collapsed && "pr-12",
      )}
    >
      <div
        className={cn(
          "flex items-center app-sidebar-shell-transition",
          collapsed ? sidebarCollapsedItemClassName : "gap-3 px-3 py-2",
        )}
      >
        <Store
          aria-hidden
          className={cn(
            "shrink-0 text-indigo-300 app-sidebar-shell-transition",
            collapsed ? "size-5" : "size-7",
          )}
        />
        <div
          className={cn(
            "min-w-0 overflow-hidden app-sidebar-label-transition",
            collapsed ? "max-w-0 opacity-0" : "max-w-[11rem] opacity-100",
          )}
        >
          <p className="truncate text-base leading-tight font-bold text-white">BodegaSync</p>
          <p className="truncate text-xs leading-snug text-sidebar-muted">{userRole}</p>
        </div>
      </div>
      {onClose ? (
        <Button
          aria-label="Cerrar menu"
          className="absolute top-1/2 right-3 h-8 w-8 shrink-0 -translate-y-1/2 p-0 text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground lg:hidden"
          onClick={onClose}
          type="button"
          variant="ghost"
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
