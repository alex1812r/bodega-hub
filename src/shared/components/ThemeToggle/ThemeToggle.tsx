"use client";

import { Moon, Sun } from "lucide-react";

import { IconButton } from "@/shared/components/IconButton";
import { useTheme } from "@/shared/theme/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <IconButton
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      icon={
        isDark ? (
          <Sun aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Moon aria-hidden="true" className="h-4 w-4" />
        )
      }
      onClick={toggleTheme}
      variant="outline"
    />
  );
}
