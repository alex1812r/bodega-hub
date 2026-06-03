"use client";

import { Menu } from "lucide-react";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { IconButton } from "@/shared/components/IconButton";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { formatVes } from "@/shared/utils/currency";

type AppHeaderProps = {
  onOpenMenu: () => void;
  onSignOut?: () => void;
  refRateError?: boolean;
  refRateVes?: number;
  userName?: string;
  userRole?: string;
};

export function AppHeader({
  onOpenMenu,
  onSignOut,
  refRateError = false,
  refRateVes,
  userName = "Admin",
  userRole = "admin",
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 lg:px-8">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconButton
            aria-label="Abrir menu de navegacion"
            className="shrink-0 lg:hidden"
            icon={<Menu className="h-5 w-5" />}
            onClick={onOpenMenu}
          />
          <div className="min-w-0">
            <p className="truncate text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
              Tasa oficial (REF/VES)
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-base font-semibold sm:text-lg">
                {refRateVes != null ? formatVes(refRateVes) : "—"}
              </span>
              {refRateError ? (
                <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                  No disponible
                </span>
              ) : null}
              <Badge className="shrink-0" variant="info">
                ref
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <div className="hidden text-right sm:block">
            <p className="max-w-[8rem] truncate text-sm font-medium lg:max-w-none">{userName}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{userRole}</p>
          </div>
          {onSignOut ? (
            <Button onClick={onSignOut} size="sm" variant="outline">
              Salir
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
