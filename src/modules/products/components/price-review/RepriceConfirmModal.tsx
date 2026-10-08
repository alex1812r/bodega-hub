"use client";

import { ArrowRight } from "lucide-react";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { formatRefUsd } from "@/shared/utils/currency";
import { priceFromMarkup } from "@/shared/utils/pricing";

import { type RepriceResult, useRepriceProducts } from "../../hooks/usePriceReview";

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
};

/** Filas de la vista previa; el resto se resume en "y N más". */
export const REPRICE_PREVIEW_ROWS = 5;

/** "Vas a cambiar el precio de 3 productos al 30 % sobre su costo." */
export function describeReprice(count: number, markupPct: number) {
  const target = count === 1 ? "1 producto" : `${count} productos`;

  return `Vas a cambiar el precio de ${target} al ${formatMarkupPct(markupPct)} sobre su costo.`;
}

/**
 * Confirmación del reprecio masivo (PRO-11, CNF-07): nombra cuántos productos
 * cambian y a qué %, con precio actual → nuevo. El precio nuevo se calcula con
 * `priceFromMarkup` de `@bodega/core`, igual que el servidor, que lo aplica solo
 * si el costo sigue siendo el de esta vista previa. Nunca se cambia un precio
 * sin esta confirmación (regla 10b).
 */
export function RepriceConfirmModal({
  markupPct,
  onDone,
  onOpenChange,
  open,
  products,
}: RepriceConfirmModalProps) {
  const reprice = useRepriceProducts();
  const preview = products.slice(0, REPRICE_PREVIEW_ROWS);
  const hidden = products.length - preview.length;

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
        <ul aria-label="Precio actual y precio nuevo" className="divide-y divide-border">
          {preview.map((product) => (
            <li
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
              key={product.id}
            >
              <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">
                {product.name}
              </span>
              {product.currentCostRef > 0 ? (
                <span className="flex items-center gap-1.5 tabular-nums">
                  <span className="text-muted-foreground">
                    {formatRefUsd(product.salePriceRef)}
                  </span>
                  <ArrowRight aria-hidden className="size-3.5 shrink-0 text-outline" />
                  <span className="sr-only">pasa a</span>
                  <span className="font-medium text-foreground">
                    {formatRefUsd(priceFromMarkup(product.currentCostRef, markupPct))}
                  </span>
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  Sin costo: no se cambiará
                </span>
              )}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="py-2 text-sm text-on-surface-variant">
              y {hidden} más con el mismo % sobre su costo
            </li>
          ) : null}
        </ul>
      )}
      title="Confirmar reprecio"
    />
  );
}
