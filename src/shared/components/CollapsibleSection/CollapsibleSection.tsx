"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useId, useState, useSyncExternalStore } from "react";

import { cn } from "@/shared/utils/cn";

const STORED_OPEN = "open";
const STORED_CLOSED = "closed";

type CollapsibleSectionProps = {
  children: ReactNode;
  className?: string;
  /** Estado inicial; también es el valor usado si no hay nada guardado o el almacenamiento falla. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Modo controlado: si se pasa, manda sobre el estado interno y el guardado. */
  open?: boolean;
  /** Clave de `localStorage` para recordar abierto/cerrado. */
  storageKey?: string;
  /** Una línea visible solo cuando la sección está cerrada. */
  summary?: ReactNode;
  title: ReactNode;
};

function readStoredOpen(storageKey: string | undefined): boolean | null {
  if (!storageKey) {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(storageKey);

    if (stored === STORED_OPEN) {
      return true;
    }

    if (stored === STORED_CLOSED) {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

function writeStoredOpen(storageKey: string, open: boolean) {
  try {
    window.localStorage.setItem(storageKey, open ? STORED_OPEN : STORED_CLOSED);
  } catch {
    // Almacenamiento bloqueado o lleno: el estado vive solo en memoria.
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);

  return () => window.removeEventListener("storage", onChange);
}

function getServerStoredOpen(): boolean | null {
  return null;
}

export function CollapsibleSection({
  children,
  className,
  defaultOpen = false,
  onOpenChange,
  open,
  storageKey,
  summary,
  title,
}: CollapsibleSectionProps) {
  const contentId = useId();
  const getStoredOpen = useCallback(() => readStoredOpen(storageKey), [storageKey]);
  const storedOpen = useSyncExternalStore(subscribeToStorage, getStoredOpen, getServerStoredOpen);
  const [toggledOpen, setToggledOpen] = useState<boolean | null>(null);
  const isOpen = open ?? toggledOpen ?? storedOpen ?? defaultOpen;

  function handleToggle() {
    const nextOpen = !isOpen;

    setToggledOpen(nextOpen);

    if (storageKey) {
      writeStoredOpen(storageKey, nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-surface-container-lowest dark:bg-slate-900",
        className,
      )}
    >
      <button
        aria-controls={contentId}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-6 dark:hover:bg-slate-800/60 dark:focus-visible:ring-offset-slate-900"
        onClick={handleToggle}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            {title}
          </span>
          {!isOpen && summary ? (
            <span className="mt-0.5 block truncate text-sm text-slate-500 dark:text-slate-400">
              {summary}
            </span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 motion-reduce:transition-none dark:text-slate-400",
            isOpen && "rotate-180",
          )}
        />
      </button>
      <div
        className="px-4 pb-4 pt-1 transition-[opacity,translate] duration-200 motion-reduce:transition-none sm:px-6 sm:pb-6 starting:-translate-y-1 starting:opacity-0"
        hidden={!isOpen}
        id={contentId}
      >
        {children}
      </div>
    </section>
  );
}
