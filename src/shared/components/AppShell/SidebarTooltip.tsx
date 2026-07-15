"use client";

import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

type SidebarTooltipProps = {
  children: ReactNode;
  className?: string;
  label: string;
  /** `bottom` evita overflow horizontal en sidebar colapsado. */
  placement?: "bottom" | "right";
  show: boolean;
};

export function SidebarTooltip({
  children,
  className,
  label,
  placement = "right",
  show,
}: SidebarTooltipProps) {
  if (!show) {
    return <>{children}</>;
  }

  return (
    <div className={cn("group/sidebar-tip relative w-full min-w-0", className)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-[60] whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover/sidebar-tip:opacity-100 group-focus-within/sidebar-tip:opacity-100",
          placement === "bottom"
            ? "top-full left-1/2 mt-2 -translate-x-1/2"
            : "top-1/2 left-[calc(100%+0.5rem)] -translate-y-1/2",
        )}
        role="tooltip"
      >
        {label}
      </span>
    </div>
  );
}
