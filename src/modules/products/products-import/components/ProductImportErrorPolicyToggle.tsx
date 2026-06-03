"use client";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";

import type { ProductImportErrorPolicy } from "../types";

type ProductImportErrorPolicyToggleProps = {
  onChange: (policy: ProductImportErrorPolicy) => void;
  value: ProductImportErrorPolicy;
};

export function ProductImportErrorPolicyToggle({
  onChange,
  value,
}: ProductImportErrorPolicyToggleProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        Si una fila falla al guardar
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => onChange("continue")}
          size="sm"
          type="button"
          variant={value === "continue" ? "primary" : "outline"}
        >
          Continuar y resumir
        </Button>
        <Button
          onClick={() => onChange("stop")}
          size="sm"
          type="button"
          variant={value === "stop" ? "primary" : "outline"}
        >
          Detener en primer error
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {value === "continue"
          ? "Se registraran las filas exitosas y veras un resumen de errores al final."
          : "La importacion se detendra cuando el servidor rechace una fila."}
      </p>
      {value === "stop" ? <Badge className="mt-2" variant="warning">Modo estricto</Badge> : null}
    </div>
  );
}
