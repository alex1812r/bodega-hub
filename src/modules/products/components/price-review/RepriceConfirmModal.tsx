"use client";

import { useReleaseAttemptOnClose, useRequestAttempt } from "@/modules/inventory/utils/requestAttempt";
import { ConfirmActionModal, type ConfirmActionStatus } from "@/shared/components/ConfirmActionModal";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { type MarginThresholds, priceFromMarkup } from "@/shared/utils/pricing";

import { type RepriceResult, useRepriceProducts } from "../../hooks/usePriceReview";
import { buildRepriceReason } from "../../services/priceReview";
import { useFreshReviewPricing } from "./freshPricing";
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
 * Al abrirse relee los seleccionados de la cola «Por revisar» (CAOS-04b): el «antes» y el
 * costo de cada fila son los de ese momento, y hasta tenerlos no deja confirmar. Un
 * seleccionado que ya no está en la cola (otro usuario le cambió o le mantuvo el precio)
 * se dice y no se envía.
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
  // Una clave por contenido: el reintento tras un error de resultado incierto
  // viaja con la misma y el servidor no repite el cambio (FIN-03).
  const requestAttempt = useRequestAttempt({ lockAfterSuccess: true, renewOnContentChange: true });
  useReleaseAttemptOnClose(requestAttempt, open);
  const freshRead = useFreshReviewPricing(
    products.map((product) => product.id),
    open,
  );
  const rows = products.map((product) => {
    const fresh = freshRead.fresh?.get(product.id);
    const change: PriceChange | null =
      fresh && fresh.currentCostRef > 0
        ? {
            costRef: fresh.currentCostRef,
            fromPriceRef: fresh.currentPriceRef,
            toPriceRef: priceFromMarkup(fresh.currentCostRef, markupPct),
          }
        : null;
    const hasChanged =
      fresh !== undefined &&
      (fresh.currentPriceRef !== product.salePriceRef ||
        fresh.currentCostRef !== product.currentCostRef);

    return { change, fresh, hasChanged, product };
  });
  // Solo viajan los que siguen en la cola, cada uno con el costo recién leído.
  const items = rows.flatMap((row) =>
    row.fresh ? [{ expectedCostRef: row.fresh.currentCostRef, productId: row.product.id }] : [],
  );
  const changes = rows.flatMap((row) => (row.change ? [row.change] : []));
  const summary = summarizePriceChanges(changes);
  const withoutCost = items.length - changes.length;
  const changedCount = rows.filter((row) => row.hasChanged).length;
  let status: ConfirmActionStatus = "ready";
  let statusMessage: string | undefined;

  if (!freshRead.fresh) {
    status = freshRead.status === "error" ? "error" : "loading";
    statusMessage =
      status === "error"
        ? "No se pudieron comprobar los precios actuales."
        : "Comprobando los precios actuales…";
  } else if (items.length === 0) {
    status = "blocked";
    statusMessage =
      "Ninguno de los productos seleccionados sigue en «Por revisar»: no hay nada que cambiar.";
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reprice.reset();
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (status !== "ready") {
      return;
    }

    // Cada producto viaja con el costo de la vista previa: si ya es otro, su fila
    // vuelve como `COST_CHANGED` y su precio no cambia.
    const content = { items, markupPct };
    const clientRequestId = requestAttempt.begin(content);

    if (!clientRequestId) {
      return;
    }

    let result: RepriceResult;

    try {
      result = await reprice.mutateAsync({ ...content, clientRequestId });
    } catch (error) {
      // El error lo muestra el modal (`reprice.error`); aquí solo se cierra el intento.
      requestAttempt.fail(error);
      throw error;
    }

    requestAttempt.succeed();
    onDone(result);
    handleOpenChange(false);
  }

  return (
    <ConfirmActionModal
      confirmLabel={items.length === 1 ? "Cambiar 1 precio" : `Cambiar ${items.length} precios`}
      description={describeReprice(status === "ready" ? items.length : products.length, markupPct)}
      error={reprice.error instanceof Error ? reprice.error.message : null}
      isPending={reprice.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      onRetry={freshRead.refetch}
      open={open}
      renderEffects={() => (
        <ul aria-label="Precio y ganancia antes y después" className="divide-y divide-border">
          {rows.map(({ change, fresh, product }) => (
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
                    {fresh ? "Sin costo: no se cambiará" : "Ya no está en «Por revisar»: no se cambiará"}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      status={status}
      statusHint={status === "ready" ? undefined : "No se ha cambiado nada."}
      statusMessage={statusMessage}
      title="Confirmar reprecio"
      variant={summary.belowCost > 0 ? "danger" : "default"}
    >
      {status === "ready" ? (
        <div className="flex flex-col gap-2">
          {changedCount > 0 ? (
            <p className="font-medium text-foreground" role="status">
              {changedCount === 1
                ? "1 producto cambió de precio o de costo desde que se cargó la lista: se muestran sus cifras actuales."
                : `${changedCount} productos cambiaron de precio o de costo desde que se cargó la lista: se muestran sus cifras actuales.`}
            </p>
          ) : null}
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
      ) : null}
    </ConfirmActionModal>
  );
}
