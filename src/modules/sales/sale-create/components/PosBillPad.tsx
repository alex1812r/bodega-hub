"use client";

import { Minus } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/shared/utils/cn";

import {
  adjustDenominationCount,
  getBillsForCurrency,
  type DenominationCounts,
  type DenominationCurrency,
} from "../utils/denominations";

const currencyWords: Record<DenominationCurrency, string> = {
  USD: "dolares",
  VES: "bolivares",
};

const currencyPrefixes: Record<DenominationCurrency, string> = {
  USD: "$",
  VES: "Bs ",
};

type PosBillPadProps = {
  /** Enfoca el primer billete al abrir el modal. */
  autoFocus?: boolean;
  className?: string;
  counts: DenominationCounts;
  currency: DenominationCurrency;
  disabled?: boolean;
  onChange: (counts: DenominationCounts) => void;
};

export function PosBillPad({
  autoFocus = false,
  className,
  counts,
  currency,
  disabled = false,
  onChange,
}: PosBillPadProps) {
  const bills = getBillsForCurrency(currency);
  const firstBillRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    // Se difiere: el dialogo mueve el foco al montar su contenido.
    const frame = requestAnimationFrame(() => firstBillRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-6", className)}>
      {bills.map((bill, index) => {
        const count = counts[bill] ?? 0;
        const label = `${currencyPrefixes[currency]}${bill}`;

        return (
          <div className="relative min-w-0" key={bill}>
            <button
              aria-label={`Agregar billete de ${bill} ${currencyWords[currency]}`}
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-2 text-sm font-semibold transition-colors",
                count > 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low dark:border-slate-700",
                disabled && "cursor-not-allowed opacity-50",
              )}
              disabled={disabled}
              onClick={() => onChange(adjustDenominationCount(counts, bill, 1))}
              ref={index === 0 ? firstBillRef : undefined}
              type="button"
            >
              <span className="truncate">{label}</span>
              <span
                className={cn(
                  "text-xs font-medium",
                  count > 0 ? "text-primary" : "text-muted-foreground",
                )}
              >
                x{count}
              </span>
            </button>

            {count > 0 && !disabled ? (
              <button
                aria-label={`Quitar billete de ${bill} ${currencyWords[currency]}`}
                className="absolute -top-2 -right-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-container-lowest text-muted-foreground shadow-sm hover:text-destructive dark:border-slate-700"
                onClick={() => onChange(adjustDenominationCount(counts, bill, -1))}
                type="button"
              >
                <Minus aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
