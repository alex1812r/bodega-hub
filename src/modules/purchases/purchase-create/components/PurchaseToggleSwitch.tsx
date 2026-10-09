"use client";

import { cn } from "@/shared/utils/cn";

type PurchaseToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

/** Interruptor con etiqueta de las cabeceras de la compra ("Compra exenta", "Bloquear al agregar"). */
export function PurchaseToggleSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: PurchaseToggleSwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full text-xs font-medium text-on-surface-variant transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-surface-container-low",
        )}
      >
        <span
          className={cn(
            "size-3.5 rounded-full transition-transform",
            checked ? "translate-x-4 bg-primary-foreground" : "bg-on-surface-variant",
          )}
        />
      </span>
      {label}
    </button>
  );
}
