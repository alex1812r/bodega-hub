"use client";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { type MarginThresholds, priceFromMarkup } from "@/shared/utils/pricing";

import { type RepriceResult, useRepriceProducts } from "../../hooks/usePriceReview";
import { buildRepriceReason } from "../../services/priceReview";
import {
  PriceBelowCostWarning,
  type PriceChange,
  PriceChangeEffect,
  summarizePriceChanges,
} from "./PriceChangeEffect";

export type RepriceProduct = {
  currentCostRef: number;
  id: string;
  name: string;
  salePriceRef: number;
};

type RepriceConfirmModalProps = {
  markupPct: number;
  /** Resultado por producto: el lote puede traer aciertos y fallos a la vez. */
  onDone: (result: RepriceResult) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  products: RepriceProduct[];
  /** Tasa vigente (Bs por REF) para mostrar cada cambio también en Bs; sin ella solo en REF. */
  rateVes?: number | null;
  /** Cortes del semáforo de la tienda; sin ellos, los por defecto. */
  thresholds?: MarginThresholds;
};

function countLabel(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Vas a cambiar el precio de 3 productos al 30 % sobre su costo." */
export function describeReprice(count: number, markupPct: number) {
  const target = count === 1 ? "1 producto" : `${count} productos`;

  return `Vas a cambiar el precio de ${target} al ${formatMarkupPct(markupPct)} sobre su costo.`;
}

/**
 * Confirmación del reprecio masivo (PRO-11, CNF-07): nombra cuántos productos
 * cambian y a qué %, resume cuántos suben, bajan y quedan bajo su costo, y lista
 * TODOS los productos con su precio y ganancia antes → después (la lista hace
 * scroll dentro del modal; el resumen y los botones quedan siempre a la vista).
 *
 * El precio nuevo se calcula con `priceFromMarkup` de `@bodega/core`, igual que
 * el servidor, que lo aplica solo si el costo sigue siendo el de esta vista
 * previa. Un producto sin costo no se cambia. Nunca se cambia un precio sin esta
 * confirmación (regla 10b).
 */
export function RepriceConfirmModal({
  markupPct,
  onDone,
  onOpenChange,
  open,
  products,
  rateVes,
  thresholds,
}: RepriceConfirmModalProps) {
  const reprice = useRepriceProducts();
  const rows = products.map((product) => {
    const change: PriceChange | null =
      product.currentCostRef > 0
        ? {
            costRef: product.currentCostRef,
            fromPriceRef: product.salePriceRef,
            toPriceRef: priceFromMarkup(product.currentCostRef, markupPct),
          }
        : null;

    return { change, product };
  });
  const changes = rows.flatMap((row) => (row.change ? [row.change] : []));
  const summary = summarizePriceChanges(changes);
  const withoutCost = rows.length - changes.length;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reprice.reset();
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    // Cada producto viaja con el costo de la vista previa: si ya es otro, su fila
    // vuelve como `COST_CHANGED` y su precio no cambia.
    const result = await reprice.mutateAsync({
      items: products.map((product) => ({
        expectedCostRef: product.currentCostRef,
        productId: product.id,
      })),
      markupPct,
    });

    onDone(result);
    handleOpenChange(false);
  }

  return (
    <ConfirmActionModal
      confirmLabel={products.length === 1 ? "Cambiar 1 precio" : `Cambiar ${products.length} precios`}
      description={describeReprice(products.length, markupPct)}
      error={reprice.error instanceof Error ? reprice.error.message : null}
      isPending={reprice.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      open={open}
      renderEffects={() => (
        <ul aria-label="Precio y ganancia antes y después" className="divide-y divide-border">
          {rows.map(({ change, product }) => (
            <li key={product.id}>
              {change ? (
                <PriceChangeEffect
                  change={change}
                  name={product.name}
                  rateVes={rateVes}
                  thresholds={thresholds}
                />
              ) : (
                <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">
                    {product.name}
                  </span>
                  <span className="text-amber-700 dark:text-amber-300">
                    Sin costo: no se cambiará
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      title="Confirmar reprecio"
      variant={summary.belowCost > 0 ? "danger" : "default"}
    >
      <div className="flex flex-col gap-2">
        <ul
          aria-label="Resumen del reprecio"
          className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums text-foreground"
        >
          <li>{countLabel(summary.up, "sube", "suben")}</li>
          <li>{countLabel(summary.down, "baja", "bajan")}</li>
          <li>{countLabel(summary.belowCost, "queda bajo su costo", "quedan bajo su costo")}</li>
          {summary.same > 0 ? <li>{countLabel(summary.same, "no cambia", "no cambian")}</li> : null}
          {withoutCost > 0 ? (
            <li>{countLabel(withoutCost, "sin costo (no se cambia)", "sin costo (no se cambian)")}</li>
          ) : null}
        </ul>
        <p className="[overflow-wrap:anywhere]">Motivo: {buildRepriceReason(markupPct)}</p>
        {summary.belowCost > 0 ? (
          <PriceBelowCostWarning>
            {summary.belowCost === 1
              ? "1 producto queda con el precio por debajo de su costo: cada venta sería a pérdida."
              : `${summary.belowCost} productos quedan con el precio por debajo de su costo: cada venta sería a pérdida.`}
          </PriceBelowCostWarning>
        ) : null}
      </div>
    </ConfirmActionModal>
  );
}
