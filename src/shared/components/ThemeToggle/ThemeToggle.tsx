"use client";

import { Moon, Sun } from "lucide-react";

import { IconButton } from "@/shared/components/IconButton";
import { useTheme } from "@/shared/theme/useTheme";
import { cn } from "@/shared/utils/cn";

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <IconButton
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className={cn(
        "h-8 w-8 rounded-full text-muted-foreground hover:bg-surface-container hover:text-primary",
        className,
      )}
      icon={
        isDark ? (
          <Sun aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Moon aria-hidden="true" className="h-4 w-4" />
        )
      }
      onClick={toggleTheme}
      variant="ghost"
    />
  );
}
