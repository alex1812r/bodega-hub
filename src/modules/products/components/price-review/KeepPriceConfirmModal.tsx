"use client";

import { useState } from "react";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { Input } from "@/shared/components/Input";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { useToast } from "@/shared/components/Toast";
import { formatRefUsd } from "@/shared/utils/currency";
import { markupPct } from "@/shared/utils/pricing";

import {
  COST_CHANGED_LEFT_QUEUE_TITLE,
  useCostConflictRefresh,
  useKeepProductPrice,
} from "../../hooks/usePriceReview";
import { PRICE_CHANGE_REASON_MAX_LENGTH } from "../../services/productSchemas";

export type KeepPriceProduct = {
  currentCostRef: number;
  id: string;
  name: string;
  salePriceRef: number;
};

type KeepPriceConfirmModalProps = {
  /**
   * Motivo que se guarda si el usuario deja el campo vacío (p. ej. la compra
   * que originó el aviso). El modal lo dice bajo el campo.
   */
  defaultReason?: string;
  /** Se llama cuando el servidor ya guardó la decisión, antes de cerrar. */
  onKept?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  product: KeepPriceProduct | null;
};

/** "El precio no cambia: se queda en ref 10.00 con una ganancia de 11 %." (sin costo no hay %). */
export function describeKeptPrice(
  product: Pick<KeepPriceProduct, "currentCostRef" | "salePriceRef">,
) {
  const pct = markupPct(product.currentCostRef, product.salePriceRef);
  const price = `El precio no cambia: se queda en ${formatRefUsd(product.salePriceRef)}`;

  return pct === null ? `${price}.` : `${price} con una ganancia de ${formatMarkupPct(pct)}.`;
}

/**
 * "Mantener precio" (PRO-11): el producto sale de "Por revisar" sin cambiar su
 * precio. El motivo es opcional; sin él el servidor guarda "Precio mantenido".
 *
 * Si el costo cambió mientras el usuario decidía (409), relee el producto: el
 * modal pasa a mostrar el costo y la ganancia actuales y el siguiente clic
 * confirma sobre ellos; si el producto ya no está en la cola, se cierra con un aviso.
 */
export function KeepPriceConfirmModal({
  defaultReason,
  onKept,
  onOpenChange,
  open,
  product: openedProduct,
}: KeepPriceConfirmModalProps) {
  const { showToast } = useToast();
  const keepPrice = useKeepProductPrice();
  const costConflict = useCostConflictRefresh();
  const [reason, setReason] = useState("");
  // Cifras releídas tras un 409: mandan sobre las que traía quien abrió el modal.
  const [refreshed, setRefreshed] = useState<KeepPriceProduct | null>(null);
  const product = refreshed && refreshed.id === openedProduct?.id ? refreshed : openedProduct;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setReason("");
      setRefreshed(null);
      keepPrice.reset();
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (!product) {
      return;
    }

    try {
      // El costo con el que se calculó la ganancia que el modal muestra: si ya es
      // otro, el servidor responde 409 y no se guarda nada.
      await keepPrice.mutateAsync({
        expectedCostRef: product.currentCostRef,
        productId: product.id,
        reason: reason.trim() || defaultReason || undefined,
      });
    } catch (error) {
      const fresh = await costConflict.fetchProduct(error, product.id);

      if (fresh && !fresh.priceReview) {
        showToast({
          description: `${product.name} ya no está en "Por revisar".`,
          title: COST_CHANGED_LEFT_QUEUE_TITLE,
          tone: "info",
        });
        handleOpenChange(false);

        return;
      }

      if (fresh) {
        setRefreshed({
          currentCostRef: fresh.currentCostRef,
          id: product.id,
          name: product.name,
          salePriceRef: fresh.salePriceRef,
        });
      }

      // El motivo del servidor sigue en el modal, ya con las cifras actuales.
      throw error;
    }

    onKept?.();
    showToast({
      description: `${product.name} salió de "Por revisar".`,
      title: "Precio mantenido",
      tone: "success",
    });
    handleOpenChange(false);
  }

  return (
    <ConfirmActionModal
      confirmLabel="Mantener precio"
      description={
        product
          ? `${describeKeptPrice(product)} Saldrá de la lista hasta que el costo vuelva a subir.`
          : ""
      }
      error={keepPrice.error instanceof Error ? keepPrice.error.message : null}
      isPending={keepPrice.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      open={open && product !== null}
      title="Mantener precio"
    >
      <div className="flex flex-col gap-3">
        <p className="font-medium text-foreground [overflow-wrap:anywhere]">{product?.name}</p>
        <Input
          disabled={keepPrice.isPending}
          helperText={defaultReason ? `Si lo dejas vacío se guarda «${defaultReason}».` : undefined}
          label="Motivo (opcional)"
          maxLength={PRICE_CHANGE_REASON_MAX_LENGTH}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Por ejemplo: precio de la competencia"
          value={reason}
        />
      </div>
    </ConfirmActionModal>
  );
}
