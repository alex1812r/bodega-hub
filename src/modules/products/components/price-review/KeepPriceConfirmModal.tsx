"use client";

import { useState } from "react";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { Input } from "@/shared/components/Input";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { useToast } from "@/shared/components/Toast";
import { formatRefUsd } from "@/shared/utils/currency";
import { markupPct } from "@/shared/utils/pricing";

import { useKeepProductPrice } from "../../hooks/usePriceReview";
import { PRICE_CHANGE_REASON_MAX_LENGTH } from "../../services/productSchemas";

export type KeepPriceProduct = {
  currentCostRef: number;
  id: string;
  name: string;
  salePriceRef: number;
};

type KeepPriceConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  product: KeepPriceProduct | null;
};

/** "El precio se queda en ref 10.00 con una ganancia de 11 %." (sin costo no hay %). */
export function describeKeptPrice(
  product: Pick<KeepPriceProduct, "currentCostRef" | "salePriceRef">,
) {
  const pct = markupPct(product.currentCostRef, product.salePriceRef);
  const price = `El precio se queda en ${formatRefUsd(product.salePriceRef)}`;

  return pct === null ? `${price}.` : `${price} con una ganancia de ${formatMarkupPct(pct)}.`;
}

/**
 * "Mantener precio" (PRO-11): el producto sale de "Por revisar" sin cambiar su
 * precio. El motivo es opcional; sin él el servidor guarda "Precio mantenido".
 */
export function KeepPriceConfirmModal({ onOpenChange, open, product }: KeepPriceConfirmModalProps) {
  const { showToast } = useToast();
  const keepPrice = useKeepProductPrice();
  const [reason, setReason] = useState("");

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setReason("");
      keepPrice.reset();
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (!product) {
      return;
    }

    // El costo con el que se calculó la ganancia que el modal muestra: si ya es
    // otro, el servidor responde 409, el error queda en el modal y los datos se refrescan.
    await keepPrice.mutateAsync({
      expectedCostRef: product.currentCostRef,
      productId: product.id,
      reason: reason.trim() || undefined,
    });
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
