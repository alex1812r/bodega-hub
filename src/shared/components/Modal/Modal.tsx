"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/shared/utils/cn";

import { Button } from "../Button";

type ModalFooterHelpers = {
  close: () => void;
};

type ModalProps = {
  bodyClassName?: string;
  children: ReactNode;
  contentClassName?: string;
  description?: string;
  footer?: ReactNode | ((helpers: ModalFooterHelpers) => ReactNode);
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: string;
  trigger?: ReactNode;
};

/**
 * Un doble clic sobre el botón que abre el diálogo deja caer su segundo clic en
 * el fondo recién montado. Durante esta ventana (el intervalo de doble clic del
 * sistema) un clic en el fondo no cierra; Esc y los botones de cerrar no esperan.
 */
const OUTSIDE_DISMISS_GRACE_MS = 500;

function clearStuckBodyPointerEvents() {
  if (document.body.style.pointerEvents === "none") {
    document.body.style.pointerEvents = "";
  }
}

// `close` llega como prop (igual que un handler) para que el footer-función se
// evalúe aquí y no en el render de Modal, donde `close` cierra sobre un ref.
function ModalFunctionFooter({
  close,
  render,
}: ModalFooterHelpers & { render: (helpers: ModalFooterHelpers) => ReactNode }) {
  return render({ close });
}

export function Modal({
  bodyClassName,
  children,
  contentClassName,
  description,
  footer,
  onOpenChange,
  open,
  title,
  trigger,
}: ModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;
  const closeTimeoutRef = useRef<number | null>(null);
  const openedAtRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    clearStuckBodyPointerEvents();

    return () => {
      if (closeTimeoutRef.current != null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      clearStuckBodyPointerEvents();
    };
  }, []);

  useEffect(() => {
    if (!currentOpen) {
      clearStuckBodyPointerEvents();
    }

    openedAtRef.current = currentOpen ? performance.now() : null;
  }, [currentOpen]);

  function applyOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (!nextOpen) {
      // Defer close until after the current pointer event finishes, so the
      // closing click cannot activate controls under the dialog (e.g. POS chips).
      closeTimeoutRef.current = window.setTimeout(() => {
        closeTimeoutRef.current = null;
        applyOpenChange(false);
      }, 0);
      return;
    }

    applyOpenChange(true);
  }

  function close() {
    handleOpenChange(false);
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={currentOpen}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50" ref={overlayRef} />
        <Dialog.Content
          className={cn(
            "fixed z-50 flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900",
            "inset-x-0 bottom-0 top-auto max-h-[90vh] rounded-t-lg p-5 sm:inset-x-auto sm:inset-y-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6",
            contentClassName,
          )}
          onCloseAutoFocus={(event) => {
            // Keep focus in the POS panel instead of jumping to an underlying chip.
            event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            const openedAt = openedAtRef.current;

            if (openedAt == null || event.detail.originalEvent.target !== overlayRef.current) {
              return;
            }

            const elapsed = performance.now() - openedAt;

            // A negative lapse means the clock was replaced: never hold the dialog open for that.
            if (elapsed >= 0 && elapsed < OUTSIDE_DISMISS_GRACE_MS) {
              event.preventDefault();
            }
          }}
        >
          <div className="shrink-0 space-y-1 pr-10">
            <Dialog.Title className="text-lg font-semibold text-slate-950 dark:text-slate-100">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                {description}
              </Dialog.Description>
            ) : null}
          </div>

          <div className={cn("mt-5 min-h-0 flex-1 overflow-y-auto pr-1", bodyClassName)}>
            {children}
          </div>

          {footer ? (
            <div className="mt-6 flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end sm:gap-3 dark:border-slate-800">
              {typeof footer === "function" ? (
                <ModalFunctionFooter close={close} render={footer} />
              ) : (
                footer
              )}
            </div>
          ) : null}

          <Dialog.Close asChild>
            <Button
              aria-label="Cerrar modal"
              className="absolute right-4 top-4 h-8 w-8 p-0"
              variant="ghost"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
