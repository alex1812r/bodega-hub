"use client";

import { TrendingDown } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { ConfirmActionModal, type ConfirmActionStatus } from "@/shared/components/ConfirmActionModal";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { useToast } from "@/shared/components/Toast";
import { formatRefUsd } from "@/shared/utils/currency";
import { priceFromMarkup, type MarginThresholds } from "@/shared/utils/pricing";

import {
  COST_CHANGED_LEFT_QUEUE_TITLE,
  useCostConflictRefresh,
  usePriceReview,
  type ProductPriceReviewItem,
} from "../../hooks/usePriceReview";
import { useUpdateProductPrice } from "../../hooks/useProducts";
import { buildRepriceReason } from "../../services/priceReview";
import { getProductMarginThresholds } from "../../services/productMargin";
import { useFreshProductPricing } from "./freshPricing";
import { FreshPricingChangedNotice } from "./FreshPricingChangedNotice";
import { KeepPriceConfirmModal, type KeepPriceProduct } from "./KeepPriceConfirmModal";
import { isPriceBelowCost, PriceChangeEffect } from "./PriceChangeEffect";
import { PriceReviewChangeSummary } from "./PriceReviewChangeSummary";

/** Filas visibles antes de "Mostrar N más". */
export const PURCHASE_REPRICE_VISIBLE_ROWS = 10;

const PRODUCTS_REVIEW_HREF = "/products?review=1";

/**
 * Reprecio que se propone para un producto de la cola: el % de ganancia que
 * tenía antes de la compra (a dos decimales, como lo muestra el semáforo)
 * aplicado sobre el costo actual. El costo ya incluye el IVA (regla 10).
 */
export function getPurchaseRepriceProposal(
  item: Pick<ProductPriceReviewItem, "currentCostRef" | "previousMarginPct">,
) {
  const markupPct = Math.round(item.previousMarginPct * 100) / 100;

  return { markupPct, salePriceRef: priceFromMarkup(item.currentCostRef, markupPct) };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type PurchaseRepriceRowProps = {
  canManage: boolean;
  item: ProductPriceReviewItem;
  thresholds: MarginThresholds;
};

function PurchaseRepriceRow({ canManage, item, thresholds }: PurchaseRepriceRowProps) {
  const updatePrice = useUpdateProductPrice(item.productId);
  const costConflict = useCostConflictRefresh();
  const { showToast } = useToast();
  // Candado de la fila: bloquea un segundo envío en el mismo tick y, tras el
  // éxito, hasta que el refresco de la cola la retira.
  const lockedRef = useRef(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isKeepOpen, setIsKeepOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tasa vigente, solo para mostrar el cambio en Bs: se pide al abrir la confirmación.
  const currentRate = useCurrentExchangeRate({ enabled: isConfirmOpen });

  // CAOS-04b: la confirmación relee el producto al abrirse; la fila sigue con lo de la cola.
  const freshRead = useFreshProductPricing(item.productId, isConfirmOpen);
  const fresh = freshRead.fresh;
  const proposal = getPurchaseRepriceProposal(item);
  // Lo que se confirma: el mismo % sobre el costo recién leído, desde el precio recién leído.
  const confirmCostRef = fresh?.currentCostRef ?? item.currentCostRef;
  const confirmFromRef = fresh?.currentPriceRef ?? item.salePriceRef;
  const confirmProposal = getPurchaseRepriceProposal({
    currentCostRef: confirmCostRef,
    previousMarginPct: item.previousMarginPct,
  });
  const purchaseNumber = item.purchase?.number.trim() ?? "";
  const currentPrice = formatRefUsd(item.salePriceRef);
  const proposedPrice = formatRefUsd(proposal.salePriceRef);
  const confirmToPrice = formatRefUsd(confirmProposal.salePriceRef);
  let confirmStatus: ConfirmActionStatus = "ready";
  let confirmStatusMessage: string | undefined;

  if (!fresh) {
    confirmStatus = freshRead.status === "error" ? "error" : "loading";
    confirmStatusMessage =
      confirmStatus === "error"
        ? "No se pudo comprobar el precio actual."
        : "Comprobando el precio actual…";
  } else if (fresh.currentPriceRef === confirmProposal.salePriceRef) {
    confirmStatus = "blocked";
    confirmStatusMessage = `El precio ya es ${confirmToPrice}: no hay nada que cambiar.`;
  }
  // Motivo que queda en el historial de precios; la confirmación lo muestra tal cual.
  const applyReason = `${buildRepriceReason(proposal.markupPct)}${purchaseNumber ? ` por compra ${purchaseNumber}` : ""}`;
  // "Mantener precio" pasa por el mismo modal que en la lista y el detalle del
  // producto; si el usuario no escribe un motivo, queda la compra que lo originó.
  const keepReason = purchaseNumber ? `Precio mantenido tras compra ${purchaseNumber}` : undefined;
  const keepProduct: KeepPriceProduct = {
    currentCostRef: item.currentCostRef,
    id: item.productId,
    name: item.name,
    salePriceRef: item.salePriceRef,
  };

  function lock() {
    if (lockedRef.current) {
      return false;
    }

    lockedRef.current = true;
    setIsLocked(true);
    setError(null);

    return true;
  }

  function unlock(message: string) {
    lockedRef.current = false;
    setIsLocked(false);
    setError(message);
  }

  // 409 por costo cambiado: la cola se relee y la fila pasa a las cifras nuevas
  // (el reintento sale del costo nuevo). Si al releerla el producto ya no está,
  // la fila desaparece: se avisa para que no se vaya en silencio.
  async function warnIfLeftQueue(error: unknown) {
    if (await costConflict.hasLeftQueue(error, item.productId)) {
      showToast({
        description: `${item.name} ya no está entre los productos por revisar de esta compra.`,
        title: COST_CHANGED_LEFT_QUEUE_TITLE,
        tone: "info",
      });
    }
  }

  async function handleApply() {
    if (!fresh || confirmStatus !== "ready" || !lock()) {
      return;
    }

    try {
      const result = await updatePrice.mutateAsync({
        // El precio propuesto sale de este costo: si ya es otro, 409 y no se aplica.
        expectedCostRef: confirmCostRef,
        reason: applyReason,
        salePriceRef: confirmProposal.salePriceRef,
      });
      // El aviso dice lo que el servidor guardó y lo que sustituyó, no lo que se preveía.
      const replacedRef = result.history?.previousSalePriceRef;
      const savedRef = result.product?.salePriceRef;

      setIsConfirmOpen(false);
      showToast({
        description: `Pasa de ${formatRefUsd(typeof replacedRef === "number" ? replacedRef : confirmFromRef)} a ${formatRefUsd(typeof savedRef === "number" ? savedRef : confirmProposal.salePriceRef)}.`,
        title: `Precio actualizado: ${item.name}`,
        tone: "success",
      });
    } catch (applyError) {
      unlock(errorMessage(applyError, "No se pudo cambiar el precio."));
      // El rechazo puede deberse a que el producto cambió (409 por costo): se relee.
      freshRead.refetch();
      await warnIfLeftQueue(applyError);
    }
  }


  return (
    <li
      className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`purchase-reprice-row-${item.productId}`}
    >
      <div className="min-w-0 space-y-1">
        <p className="min-w-0 break-words text-sm">
          <Link
            className="font-semibold text-foreground underline-offset-2 hover:underline"
            href={`/products/${item.productId}`}
          >
            {item.name}
          </Link>{" "}
          <span className="text-on-surface-variant">{item.sku}</span>
        </p>
        <PriceReviewChangeSummary change={item} showBands thresholds={thresholds} />
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tabular-nums">
          <span className="text-on-surface-variant">PVP {currentPrice}</span>
          <span aria-hidden className="text-on-surface-variant">
            ·
          </span>
          <span className="font-medium text-foreground">
            Reprecio al {formatMarkupPct(proposal.markupPct)} → {proposedPrice}
          </span>
        </p>
        {error && !isConfirmOpen ? (
          <p className="break-words text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            disabled={isLocked}
            onClick={() => {
              setError(null);
              setIsConfirmOpen(true);
            }}
            size="sm"
          >
            Aplicar
          </Button>
          <Button
            disabled={isLocked}
            onClick={() => {
              setError(null);
              setIsKeepOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            Mantener precio
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <ConfirmActionModal
          confirmLabel="Aplicar precio"
          description={
            fresh
              ? `El precio de ${item.name} pasa de ${formatRefUsd(confirmFromRef)} a ${confirmToPrice}.`
              : `Reprecio de ${item.name} al ${formatMarkupPct(proposal.markupPct)}.`
          }
          error={error}
          isPending={updatePrice.isPending}
          onConfirm={handleApply}
          onOpenChange={setIsConfirmOpen}
          onRetry={freshRead.refetch}
          open={isConfirmOpen}
          renderEffects={() => (
            <PriceChangeEffect
              change={{
                costRef: confirmCostRef,
                fromPriceRef: confirmFromRef,
                toPriceRef: confirmProposal.salePriceRef,
              }}
              rateVes={currentRate.data?.rateVes}
              reason={applyReason}
              thresholds={thresholds}
            />
          )}
          status={confirmStatus}
          statusHint={confirmStatus === "ready" ? undefined : "No se ha cambiado nada."}
          statusMessage={confirmStatusMessage}
          title="Aplicar reprecio"
          variant={
            isPriceBelowCost(confirmCostRef, confirmProposal.salePriceRef) ? "danger" : "default"
          }
        >
          {fresh && confirmStatus === "ready" ? (
            <FreshPricingChangedNotice
              fresh={fresh}
              shown={{ currentCostRef: item.currentCostRef, currentPriceRef: item.salePriceRef }}
              since="desde que se cargó este aviso"
            />
          ) : null}
        </ConfirmActionModal>
      ) : null}

      {canManage ? (
        <KeepPriceConfirmModal
          defaultReason={keepReason}
          onKept={lock}
          onOpenChange={setIsKeepOpen}
          open={isKeepOpen}
          product={keepProduct}
        />
      ) : null}
    </li>
  );
}

function PurchaseRepriceList({ canManage, purchaseId }: { canManage: boolean; purchaseId: string }) {
  const review = usePriceReview({ limit: MAX_PAGE_LIMIT, purchaseId });
  // Semáforo de la tienda; sin datos (cargando o error) valen los cortes por defecto.
  const pricingSettings = usePricingSettings();
  const [showAll, setShowAll] = useState(false);

  if (review.isError) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant" role="status">
        No pudimos comprobar si esta compra bajó la ganancia de algún producto.
        <Button onClick={() => void review.refetch()} size="sm" variant="ghost">
          Reintentar
        </Button>
      </p>
    );
  }

  const items = review.data?.items ?? [];

  if (items.length === 0) {
    return null;
  }

  const total = Math.max(review.data?.total ?? 0, items.length);
  const visibleItems = showAll ? items : items.slice(0, PURCHASE_REPRICE_VISIBLE_ROWS);
  const hiddenCount = items.length - visibleItems.length;
  const supplierName = items.find((item) => item.purchase?.supplierName)?.purchase?.supplierName;

  return (
    <section
      aria-labelledby="purchase-reprice-title"
      className="rounded-lg border border-border bg-surface-container-lowest p-4 shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <TrendingDown aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground" id="purchase-reprice-title">
              Productos que bajaron de ganancia con esta compra
            </h3>
            <p className="mt-0.5 break-words text-sm text-on-surface-variant">
              {total === 1 ? "1 producto" : `${total} productos`}
              {supplierName ? ` · Proveedor: ${supplierName}` : ""}
            </p>
          </div>
        </div>
        {total > PURCHASE_REPRICE_VISIBLE_ROWS ? (
          <Link
            className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline dark:text-indigo-300"
            href={PRODUCTS_REVIEW_HREF}
          >
            Ver todos en Productos
          </Link>
        ) : null}
      </header>

      <ul className="mt-2 divide-y divide-border">
        {visibleItems.map((item) => (
          <PurchaseRepriceRow
            canManage={canManage}
            item={item}
            key={item.productId}
            thresholds={getProductMarginThresholds(pricingSettings.data)}
          />
        ))}
      </ul>

      {hiddenCount > 0 ? (
        <Button className="mt-2" onClick={() => setShowAll(true)} size="sm" variant="ghost">
          Mostrar {hiddenCount} más
        </Button>
      ) : null}
    </section>
  );
}

/**
 * Aviso del detalle de una compra (PRO-10): productos cuyo costo subió con ella
 * y cuya ganancia bajó de banda, con "Aplicar" (reprecio al % que tenían) y
 * "Mantener precio" (el mismo `KeepPriceConfirmModal` de la lista y el detalle
 * del producto). Las dos confirman antes de enviar; nunca cambia un precio sin
 * el clic del usuario (regla 10b).
 *
 * Sin filas, mientras carga o sin permiso `products.view` no pinta nada; las
 * acciones exigen `products.manage`.
 */
export function PurchaseRepriceNotice({ purchaseId }: { purchaseId: string }) {
  const { can } = usePermission();

  if (!purchaseId || !can("products.view")) {
    return null;
  }

  return <PurchaseRepriceList canManage={can("products.manage")} purchaseId={purchaseId} />;
}
