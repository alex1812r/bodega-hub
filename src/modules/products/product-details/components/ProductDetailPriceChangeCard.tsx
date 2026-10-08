"use client";

import { Save, Tag } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { PricingFields } from "@/shared/components/PricingFields";
import { markupPct } from "@/shared/utils/pricing";

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
   * Recibe el precio nuevo y el motivo que quedó en el campo (el propuesto o el
   * escrito a mano; "" si no hay), que se guarda en el historial de precios. No
   * se llama si el precio no cambió o está vacío.
   */
  onSubmit: (salePriceRef: number, reason: string) => void | Promise<void>;
  /**
   * Chips y cortes del semáforo de la tienda (`usePricingSettings().data`). Sin
   * ellos (cargando o la consulta falló) se usan los por defecto.
   */
  pricing?: ProductPricingSettings | null;
};

const NEW_PRICE_REQUIRED_MESSAGE = "Escribe el nuevo precio.";

/** Motivo propuesto para un precio que deja la ganancia en `pct` ("Ajuste de margen a 24,99 %"). */
export function getMarginAdjustmentReason(pct: number) {
  return `Ajuste de margen a ${formatMarkupPct(pct)}`;
}

/**
 * Cambio de precio del detalle: el costo actual es de solo lectura; un chip o
 * un % completan el precio nuevo y editar el precio recalcula el %. El motivo
 * se propone solo ("Ajuste de margen a X %") hasta que el usuario escribe el suyo.
 */
export function ProductDetailPriceChangeCard({
  categoryMarkupPct,
  currentCostRef,
  currentPriceRef,
  isSubmitting = false,
  onSubmit,
  pricing,
}: ProductDetailPriceChangeCardProps) {
  const [price, setPrice] = useState<number | null>(currentPriceRef);
  // `null` = el usuario no ha escrito un motivo: se muestra el propuesto.
  const [typedReason, setTypedReason] = useState<string | null>(null);
  const [showPriceRequired, setShowPriceRequired] = useState(false);
  const [syncedPriceRef, setSyncedPriceRef] = useState(currentPriceRef);
  const pricingOptions = getProductPricingOptions(pricing);

  // Tras cada cambio confirmado, el precio en edición se realinea con el
  // guardado y el motivo vuelve a proponerse.
  if (syncedPriceRef !== currentPriceRef) {
    setSyncedPriceRef(currentPriceRef);
    setPrice(currentPriceRef);
    setTypedReason(null);
    setShowPriceRequired(false);
  }

  const resultingPct =
    price === null || price === currentPriceRef ? null : markupPct(currentCostRef, price);
  const suggestedReason = resultingPct === null ? "" : getMarginAdjustmentReason(resultingPct);
  const reason = typedReason ?? suggestedReason;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (price === null) {
      setShowPriceRequired(true);

      return;
    }

    if (!Number.isFinite(price) || price < 0 || price === currentPriceRef) {
      return;
    }

    await onSubmit(price, reason.trim());
  }

  return (
    <section className="rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Tag aria-hidden className="size-5 text-primary" />
        Cambio rápido de precio
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
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
    </section>
  );
}
