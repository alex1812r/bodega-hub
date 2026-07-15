"use client";

import * as Dialog from "@radix-ui/react-dialog";

import { type AppNavItem } from "./appShellNav";
import { AppNavLinks } from "./AppNavLinks";
import { SidebarBrand } from "./SidebarBrand";
import { SidebarFooter } from "./SidebarFooter";

type MobileNavDrawerProps = {
  currentPath: string;
  items: AppNavItem[];
  onOpenChange: (open: boolean) => void;
  onSignOut?: () => void;
  open: boolean;
  userRole?: string;
};

export function MobileNavDrawer({
  currentPath,
  items,
  onOpenChange,
  onSignOut,
  open,
  userRole,
}: MobileNavDrawerProps) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-sidebar-foreground/20 bg-sidebar text-sidebar-foreground shadow-xl outline-none lg:hidden"
        >
          <Dialog.Title className="sr-only">Menu de navegacion</Dialog.Title>
          <SidebarBrand onClose={() => onOpenChange(false)} userRole={userRole} />
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <AppNavLinks
              currentPath={currentPath}
              items={items}
              onNavigate={() => onOpenChange(false)}
            />
          </div>
          <SidebarFooter onSignOut={onSignOut} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
