"use client";

import { Search } from "lucide-react";
import { forwardRef, type KeyboardEvent } from "react";

import { cn } from "@/shared/utils/cn";

import { PosBarcodeScannerIcon } from "./PosBarcodeScannerIcon";

type PosCatalogToolbarProps = {
  autoFocus?: boolean;
  embedded?: boolean;
  isLookingUp?: boolean;
  onOpenScan: () => void;
  onScanSubmit?: (code: string) => void;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  scanError?: string | null;
  search: string;
};

export const PosCatalogToolbar = forwardRef<HTMLInputElement, PosCatalogToolbarProps>(
  function PosCatalogToolbar(
    {
      autoFocus = true,
      embedded = false,
      isLookingUp = false,
      onOpenScan,
      onScanSubmit,
      onSearchChange,
      placeholder = "Buscar por nombre o codigo de barras... (Ej. Harina PAN)",
      scanError,
      search,
    },
    ref,
  ) {
    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key !== "Enter" || !onScanSubmit) {
        return;
      }

      // Prefer the live input value: barcode scanners type + Enter faster than React state updates.
      const code = event.currentTarget.value.trim() || search.trim();
      if (!code) {
        return;
      }

      event.preventDefault();
      onScanSubmit(code);
    }

    const toolbar = (
      <div className="space-y-2">
        <div
          className={cn(
            "flex w-full overflow-hidden rounded-xl border border-border/80 bg-surface shadow-sm dark:border-slate-700",
            "focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/25",
            scanError && "border-red-500 focus-within:border-red-500 focus-within:ring-red-100",
          )}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={ref}
              aria-busy={isLookingUp}
              aria-describedby={scanError ? "pos-scan-error" : undefined}
              aria-invalid={scanError ? true : undefined}
              aria-label="Buscar productos"
              autoFocus={autoFocus && !embedded}
              className="h-12 w-full border-0 bg-transparent py-0 pr-3 pl-10 text-base text-foreground outline-none placeholder:text-muted-foreground/80"
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              // Keep focus during lookup: `disabled` blurs and breaks continuous USB scanning.
              readOnly={isLookingUp}
              type="search"
              value={search}
            />
          </div>
          <button
            aria-label="Escanear codigo"
            className="flex w-12 shrink-0 cursor-pointer items-center justify-center bg-primary text-indigo-100 transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-indigo-500"
            disabled={isLookingUp}
            onClick={onOpenScan}
            type="button"
          >
            <PosBarcodeScannerIcon />
          </button>
        </div>
        {scanError ? (
          <p className="text-sm text-red-600 dark:text-red-400" id="pos-scan-error" role="alert">
            {scanError}
          </p>
        ) : null}
      </div>
    );

    if (embedded) {
      return toolbar;
    }

    return (
      <div className="shrink-0 border-b border-border bg-surface-container-lowest/80 px-4 py-4 backdrop-blur-md dark:border-slate-800">
        {toolbar}
      </div>
    );
  },
);
