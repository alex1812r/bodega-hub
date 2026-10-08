import { AlertTriangle, CircleCheck, X } from "lucide-react";

import { IconButton } from "@/shared/components/IconButton";

import type { RepriceResult } from "../../hooks/usePriceReview";

type PriceReviewRepriceResultProps = {
  onDismiss: () => void;
  /** Nombre de cada producto del lote, por id. */
  productNames: Readonly<Record<string, string>>;
  result: RepriceResult;
};

const FAILURE_LABELS: Record<string, string> = {
  NO_COST: "Sin costo",
};

/** "3 precios actualizados" / "1 precio actualizado" / "Ningún precio actualizado". */
export function describeRepriceUpdated(updated: number) {
  if (updated === 0) {
    return "Ningún precio actualizado";
  }

  return updated === 1 ? "1 precio actualizado" : `${updated} precios actualizados`;
}

/** Resultado por fila del reprecio masivo: cuántos cambiaron y cuáles fallaron y por qué. */
export function PriceReviewRepriceResult({
  onDismiss,
  productNames,
  result,
}: PriceReviewRepriceResultProps) {
  const failures = result.results.filter((row) => row.status === "error");

  return (
    <section
      aria-label="Resultado del reprecio"
      className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800"
    >
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <CircleCheck
            aria-hidden
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
          {describeRepriceUpdated(result.updated)}
        </p>
        {failures.length > 0 ? (
          <>
            <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle aria-hidden className="size-4 shrink-0" />
              {failures.length === 1
                ? "1 no se pudo cambiar y sigue seleccionado:"
                : `${failures.length} no se pudieron cambiar y siguen seleccionados:`}
            </p>
            <ul className="space-y-1 pl-6">
              {failures.map((failure) => (
                <li className="[overflow-wrap:anywhere]" key={failure.productId}>
                  <span className="font-medium text-foreground">
                    {productNames[failure.productId] ?? "Producto"}
                  </span>
                  <span className="text-on-surface-variant">
                    {" · "}
                    {FAILURE_LABELS[failure.code] ?? failure.message}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <IconButton
        aria-label="Cerrar el resultado del reprecio"
        icon={<X className="size-4" />}
        onClick={onDismiss}
        variant="ghost"
      />
    </section>
  );
}
