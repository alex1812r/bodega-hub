"use client";

import Link from "next/link";
import { useState } from "react";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { cn } from "@/shared/utils/cn";

import {
  findActiveNavGroupId,
  getAppNavGroupStorageKey,
  type AppNavGroup,
  type AppNavItem,
} from "./appShellNav";
import {
  sidebarCollapsedItemClassName,
  sidebarCollapsedNavClassName,
} from "./sidebarCollapsedLayout";
import { SidebarTooltip } from "./SidebarTooltip";

type AppNavLinksProps = {
  collapsed?: boolean;
  currentPath: string;
  groups: AppNavGroup[];
  onNavigate?: () => void;
};

type AppNavLinkProps = {
  collapsed: boolean;
  currentPath: string;
  item: AppNavItem;
  onNavigate?: () => void;
};

/**
 * Adapta `CollapsibleSection` (pensado como tarjeta sobre fondo claro) a la
 * barra lateral: sin borde ni fondo, cabecera con los colores del sidebar y
 * contenido sin sangría para que los enlaces ocupen todo el ancho.
 */
const navGroupSectionClassName = cn(
  "rounded-none border-0 bg-transparent dark:bg-transparent",
  "[&>button]:rounded-none [&>button]:px-5 [&>button]:py-2",
  "[&>button:hover]:bg-white/10 dark:[&>button:hover]:bg-white/10",
  "[&>button:focus-visible]:ring-inset [&>button:focus-visible]:ring-offset-0",
  "[&>button>svg]:size-4 [&>button>svg]:text-sidebar-muted",
  "[&>div]:p-0",
);

function AppNavLink({ collapsed, currentPath, item, onNavigate }: AppNavLinkProps) {
  const Icon = item.icon;
  const isActive = currentPath === item.href;

  return (
    <SidebarTooltip label={item.label} placement="bottom" show={collapsed}>
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
    </SidebarTooltip>
  );
}

type AppNavGroupSectionProps = {
  currentPath: string;
  group: AppNavGroup;
  isActiveGroup: boolean;
  onNavigate?: () => void;
};

function AppNavGroupSection({
  currentPath,
  group,
  isActiveGroup,
  onNavigate,
}: AppNavGroupSectionProps) {
  // Lo que el usuario pliega/despliega vale mientras siga en la misma ruta: al
  // llegar a otra, el grupo de la ruta activa vuelve a mostrarse abierto.
  const [toggled, setToggled] = useState<{ open: boolean; path: string } | null>(null);
  const toggledOpen = toggled?.path === currentPath ? toggled.open : null;

  return (
    <CollapsibleSection
      className={navGroupSectionClassName}
      defaultOpen={group.defaultOpen}
      onOpenChange={(open) => setToggled({ open, path: currentPath })}
      // El grupo de la ruta activa manda sobre lo guardado; el resto usa lo
      // recordado en `localStorage` o, si no hay, el valor por defecto del rol.
      open={isActiveGroup ? (toggledOpen ?? true) : undefined}
      storageKey={getAppNavGroupStorageKey(group.id)}
      title={
        <span className="block text-xs font-semibold tracking-wider text-sidebar-muted uppercase">
          {group.label}
        </span>
      }
    >
      <div className="flex flex-col">
        {group.items.map((item) => (
          <AppNavLink
            collapsed={false}
            currentPath={currentPath}
            item={item}
            key={item.href}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

export function AppNavLinks({
  collapsed = false,
  currentPath,
  groups,
  onNavigate,
}: AppNavLinksProps) {
  const activeGroupId = findActiveNavGroupId(groups, currentPath);

  return (
    <nav
      aria-label="Navegación principal"
      className={cn("flex flex-col", collapsed && sidebarCollapsedNavClassName)}
    >
      {collapsed
        ? groups.map((group, index) => (
            <div
              aria-label={group.label}
              className={cn(
                "flex flex-col items-stretch gap-1",
                index > 0 && "mt-1 border-t border-sidebar-foreground/20 pt-2",
              )}
              key={group.id}
              role="group"
            >
              {group.items.map((item) => (
                <AppNavLink
                  collapsed
                  currentPath={currentPath}
                  item={item}
                  key={item.href}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))
        : groups.map((group) => (
            <AppNavGroupSection
              currentPath={currentPath}
              group={group}
              isActiveGroup={group.id === activeGroupId}
              key={group.id}
              onNavigate={onNavigate}
            />
          ))}
    </nav>
  );
}
