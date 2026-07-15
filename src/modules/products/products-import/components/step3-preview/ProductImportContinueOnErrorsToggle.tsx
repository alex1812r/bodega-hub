"use client";

import { cn } from "@/shared/utils/cn";

import type { ProductImportErrorPolicy } from "../../types";

type ProductImportContinueOnErrorsToggleProps = {
  onChange: (policy: ProductImportErrorPolicy) => void;
  value: ProductImportErrorPolicy;
};

export function ProductImportContinueOnErrorsToggle({
  onChange,
  value,
}: ProductImportContinueOnErrorsToggleProps) {
  const continueOnErrors = value === "continue";

  return (
    <label className="group flex cursor-pointer items-center gap-2">
      <span className="sr-only">Continuar si hay errores al importar</span>
      <input
        checked={continueOnErrors}
        className="peer sr-only"
        onChange={(event) =>
          onChange(event.target.checked ? "continue" : "stop")
        }
        type="checkbox"
      />
      <span
        className={cn(
          "relative h-6 w-10 rounded-full bg-outline-variant transition-colors",
          "after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-outline-variant/50 after:bg-white after:transition-all",
          "peer-checked:bg-error peer-checked:after:translate-x-4",
        )}
      />
      <span className="text-sm text-on-surface-variant transition-colors group-hover:text-on-surface">
        Continuar si hay errores
      </span>
    </label>
  );
}
