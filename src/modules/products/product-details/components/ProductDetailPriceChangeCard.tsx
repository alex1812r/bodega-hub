"use client";

import { Save, Tag } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { Input } from "@/shared/components/Input";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { PricingFields } from "@/shared/components/PricingFields";
import { formatRefUsd } from "@/shared/utils/currency";
import { markupPct } from "@/shared/utils/pricing";

import {
  isPriceBelowCost,
  PriceChangeEffect,
} from "../../components/price-review/PriceChangeEffect";
import {
  getProductPricingOptions,
  type ProductPricingSettings,
} from "../../services/productMargin";
import { PRICE_CHANGE_REASON_MAX_LENGTH } from "../../services/productSchemas";

type ProductDetailPriceChangeCardProps = {
  /** % de ganancia sugerido de la categoría del producto: primer chip, destacado. */
  categoryMarkupPct?: number | null;
  /** Costo actual en REF (ya con IVA). Solo se muestra: aquí no se edita. */
  currentCostRef: number;
  currentPriceRef: number;
  isSubmitting?: boolean;
  /**
   * Se llama UNA vez por intento, al confirmar en el modal (nunca al pulsar
   * "Actualizar precio"). Recibe el precio nuevo y el motivo que quedó en el
   * campo (el propuesto o el escrito a mano; "" si no hay), que se guarda en el
   * historial de precios. No se llama si el precio no cambió o está vacío. El
   * tercer argumento es el costo que la tarjeta mostraba al enviar: el servidor
   * rechaza el cambio (409) si el producto ya cuesta otra cosa.
   *
   * Debe devolver la promesa del guardado: mientras está en vuelo el modal queda
   * bloqueado; si se rechaza, su `message` se muestra tal cual en el modal, que
   * sigue abierto para reintentar; si se cumple, el modal se cierra.
   */
  onSubmit: (salePriceRef: number, reason: string, expectedCostRef: number) => void | Promise<void>;
  /**
   * Chips y cortes del semáforo de la tienda (`usePricingSettings().data`). Sin
   * ellos (cargando o la consulta falló) se usan los por defecto.
   */
  pricing?: ProductPricingSettings | null;
  /** Nombre del producto, para nombrarlo en la confirmación. */
  productName?: string;
  /** Tasa vigente (Bs por REF) para mostrar el cambio también en Bs; sin ella solo en REF. */
  rateVes?: number | null;
};

const NEW_PRICE_REQUIRED_MESSAGE = "Escribe el nuevo precio.";
const PRICE_UPDATE_FALLBACK_ERROR = "No se pudo cambiar el precio.";

/** Motivo propuesto para un precio que deja la ganancia en `pct` ("Ajuste de margen a 24,99 %"). */
export function getMarginAdjustmentReason(pct: number) {
  return `Ajuste de margen a ${formatMarkupPct(pct)}`;
}

/**
 * Cambio de precio del detalle: el costo actual es de solo lectura; un chip o
 * un % completan el precio nuevo y editar el precio recalcula el %. El motivo
 * se propone solo ("Ajuste de margen a X %") hasta que el usuario escribe el suyo.
 *
 * "Actualizar precio" no guarda: abre la confirmación (CNF-07) con el precio
 * anterior → nuevo en REF y Bs, la ganancia anterior → nueva y el motivo. Si el
 * precio no cambió no hay nada que confirmar y el modal no se abre.
 */
export function ProductDetailPriceChangeCard({
  categoryMarkupPct,
  currentCostRef,
  currentPriceRef,
  isSubmitting = false,
  onSubmit,
  pricing,
  productName,
  rateVes,
}: ProductDetailPriceChangeCardProps) {
  const [price, setPrice] = useState<number | null>(currentPriceRef);
  // `null` = el usuario no ha escrito un motivo: se muestra el propuesto.
  const [typedReason, setTypedReason] = useState<string | null>(null);
  const [showPriceRequired, setShowPriceRequired] = useState(false);
  const [syncedPriceRef, setSyncedPriceRef] = useState(currentPriceRef);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Precio ya guardado que la página aún no ha releído: no se vuelve a enviar.
  const [savedPriceRef, setSavedPriceRef] = useState<number | null>(null);
  // Un solo envío por intento, aunque dos confirmaciones caigan en el mismo tick.
  const isSendingRef = useRef(false);
  const pricingOptions = getProductPricingOptions(pricing);

  // Tras cada cambio confirmado, el precio en edición se realinea con el
  // guardado y el motivo vuelve a proponerse.
  if (syncedPriceRef !== currentPriceRef) {
    setSyncedPriceRef(currentPriceRef);
    setPrice(currentPriceRef);
    setTypedReason(null);
    setShowPriceRequired(false);
    setSavedPriceRef(null);
  }

  const resultingPct =
    price === null || price === currentPriceRef ? null : markupPct(currentCostRef, price);
  const suggestedReason = resultingPct === null ? "" : getMarginAdjustmentReason(resultingPct);
  const reason = typedReason ?? suggestedReason;
  const trimmedReason = reason.trim();
  const isBelowCost = price !== null && isPriceBelowCost(currentCostRef, price);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (price === null) {
      setShowPriceRequired(true);

      return;
    }

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      price === currentPriceRef ||
      price === savedPriceRef
    ) {
      return;
    }

    setConfirmError(null);
    setIsConfirmOpen(true);
  }

  async function handleConfirm() {
    if (price === null || isSendingRef.current) {
      return;
    }

    isSendingRef.current = true;
    setConfirmError(null);

    try {
      await onSubmit(price, trimmedReason, currentCostRef);
      setSavedPriceRef(price);
      setIsConfirmOpen(false);
    } catch (error) {
      setConfirmError(
        error instanceof Error && error.message ? error.message : PRICE_UPDATE_FALLBACK_ERROR,
      );
    } finally {
      isSendingRef.current = false;
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Tag aria-hidden className="size-5 text-primary" />
        Cambio rápido de precio
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <PricingFields
          chips={pricingOptions.chips}
          cost={currentCostRef}
          error={showPriceRequired && price === null ? NEW_PRICE_REQUIRED_MESSAGE : undefined}
          onPriceChange={setPrice}
          price={price}
          suggestedPct={categoryMarkupPct}
          thresholds={pricingOptions.thresholds}
        />
        <Input
          label="Motivo"
          maxLength={PRICE_CHANGE_REASON_MAX_LENGTH}
          onChange={(event) => setTypedReason(event.target.value)}
          placeholder="Opcional"
          value={reason}
        />
        <Button
          className="w-full gap-2"
          disabled={isSubmitting}
          type="submit"
        >
          <Save aria-hidden className="size-[1.125rem]" />
          {isSubmitting ? "Actualizando..." : "Actualizar precio"}
        </Button>
      </form>
      {price !== null ? (
        <ConfirmActionModal
          confirmLabel="Cambiar precio"
          description={
            productName
              ? `El precio de ${productName} pasa de ${formatRefUsd(currentPriceRef)} a ${formatRefUsd(price)}.`
              : `El precio pasa de ${formatRefUsd(currentPriceRef)} a ${formatRefUsd(price)}.`
          }
          error={confirmError}
          isPending={isSubmitting}
          onConfirm={handleConfirm}
          onOpenChange={setIsConfirmOpen}
          open={isConfirmOpen}
          renderEffects={() => (
            <PriceChangeEffect
              change={{ costRef: currentCostRef, fromPriceRef: currentPriceRef, toPriceRef: price }}
              rateVes={rateVes}
              reason={trimmedReason}
              thresholds={pricingOptions.thresholds}
            />
          )}
          title="Confirmar cambio de precio"
          variant={isBelowCost ? "danger" : "default"}
        />
      ) : null}
    </section>
  );
}
