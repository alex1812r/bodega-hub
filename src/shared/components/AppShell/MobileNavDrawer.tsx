"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/shared/components/Button";

import { type AppNavItem } from "./appShellNav";
import { AppNavLinks } from "./AppNavLinks";

type MobileNavDrawerProps = {
  currentPath: string;
  items: AppNavItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function MobileNavDrawer({
  currentPath,
  items,
  onOpenChange,
  open,
}: MobileNavDrawerProps) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-slate-200 bg-white p-5 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-900 lg:hidden"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                Control Ventas
              </p>
              <Dialog.Title className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                ERP Web
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="Cerrar menu" className="h-8 w-8 shrink-0 p-0" variant="ghost">
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="mt-8 min-h-0 flex-1 overflow-y-auto">
            <AppNavLinks
              currentPath={currentPath}
              items={items}
              onNavigate={() => onOpenChange(false)}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
