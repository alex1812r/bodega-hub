"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/utils/cn";

import { purchaseLineFieldControlClassName } from "../utils/purchaseCreateStyles";
import { PurchaseLineFieldBox } from "./PurchaseLineFieldBox";

type PurchaseLineTaxFieldProps = {
  onChange: (taxRate: number) => void;
  productName: string;
  taxRate: number;
};

function clampTaxRate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/** Impuesto bloqueado por defecto; el lapiz habilita editar el % (casos exentos / factura especial). */
export function PurchaseLineTaxField({ onChange, productName, taxRate }: PurchaseLineTaxFieldProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  return (
    <PurchaseLineFieldBox
      align="left"
      headerAction={
        <button
          aria-label={
            editing
              ? `Bloquear impuesto de ${productName}`
              : `Editar impuesto de ${productName}`
          }
          aria-pressed={editing}
          className={cn(
            "flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-container-lowest text-on-surface-variant shadow-sm transition-colors",
            "hover:border-primary/40 hover:text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            editing && "border-primary/50 text-primary",
            "dark:border-slate-700 dark:bg-slate-900",
          )}
          onClick={() => setEditing((current) => !current)}
          type="button"
        >
          <Pencil aria-hidden className="size-3" strokeWidth={2.25} />
        </button>
      }
      label="Impuesto"
      locked={!editing}
    >
      {editing ? (
        <div className="flex h-7 items-center gap-0.5">
          <input
            aria-label={`Porcentaje de impuesto de ${productName}`}
            className={cn(purchaseLineFieldControlClassName, "min-w-0 flex-1")}
            max={100}
            min={0}
            onChange={(event) => onChange(clampTaxRate(Number(event.target.value) || 0))}
            ref={inputRef}
            step="0.01"
            type="number"
            value={taxRate}
          />
          <span className="shrink-0 text-xs text-on-surface-variant">%</span>
        </div>
      ) : (
        <p className="h-7 text-xs leading-7 tabular-nums text-foreground">{taxRate}%</p>
      )}
    </PurchaseLineFieldBox>
  );
}
