"use client";

import { Menu, UserCircle } from "lucide-react";

import { IconButton } from "@/shared/components/IconButton";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { cn } from "@/shared/utils/cn";

import { ExchangeRateBadge } from "./ExchangeRateBadge";

type AppHeaderProps = {
  className?: string;
  onOpenMenu: () => void;
  refRateError?: boolean;
  refRateVes?: number;
  userName?: string;
  userRole?: string;
};

export function AppHeader({
  className,
  onOpenMenu,
  refRateError = false,
  refRateVes,
  userName = "Admin",
  userRole = "Administrador",
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-16 w-full shrink-0 items-center justify-between gap-3 border-b border-outline-variant bg-surface px-4 lg:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IconButton
          aria-label="Abrir menu de navegacion"
          className="shrink-0 text-foreground hover:bg-surface-container hover:text-primary lg:hidden"
          icon={<Menu className="h-5 w-5" />}
          onClick={onOpenMenu}
          variant="ghost"
        />
        <ExchangeRateBadge hasError={refRateError} rateVes={refRateVes} />
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <div className="hidden items-center gap-2 border-l border-border pl-4 sm:flex">
          <div className="text-right">
            <p className="max-w-[10rem] truncate text-sm font-bold leading-tight text-foreground lg:max-w-none">
              {userName}
            </p>
            <p className="text-xs text-muted-foreground">{userRole}</p>
          </div>
          <UserCircle
            aria-hidden
            className="h-8 w-8 shrink-0 text-muted-foreground"
          />
        </div>
      </div>
    </header>
  );
}
