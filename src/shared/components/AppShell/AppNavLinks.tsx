"use client";

import Link from "next/link";

import { cn } from "@/shared/utils/cn";

import { type AppNavItem } from "./appShellNav";

type AppNavLinksProps = {
  currentPath: string;
  items: AppNavItem[];
  onNavigate?: () => void;
};

export function AppNavLinks({ currentPath, items, onNavigate }: AppNavLinksProps) {
  return (
    <nav aria-label="Navegacion principal" className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.href;

        return (
          <Link
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
              isActive && "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
            )}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
          >
            <Icon aria-hidden className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
