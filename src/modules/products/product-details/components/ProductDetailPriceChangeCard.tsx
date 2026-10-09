"use client";

import { Save, Tag } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { ConfirmActionModal, type ConfirmActionStatus } from "@/shared/components/ConfirmActionModal";
import { Input } from "@/shared/components/Input";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { PricingFields } from "@/shared/components/PricingFields";
import { useToast } from "@/shared/components/Toast";
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

/** Precio y costo del producto recién leídos del servidor. */
export type FreshProductPricing = { currentCostRef: number; currentPriceRef: number };

/** Lo que el servidor devolvió al guardar: el precio que quedó y el que sustituyó. */
export type PriceChangeSubmitResult = {
  previousSalePriceRef?: number | null;
  salePriceRef?: number;
};

type FreshRead =
  | { status: "error" | "loading" }
  | { status: "ready"; value: FreshProductPricing };

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
   * sigue abierto para reintentar; si se cumple, el modal se cierra. Si resuelve
   * con lo que devolvió el servidor, el aviso de éxito lo dice.
   */
  onSubmit: (
    salePriceRef: number,
    reason: string,
    expectedCostRef: number,
  ) => PriceChangeSubmitResult | void | Promise<PriceChangeSubmitResult | void>;
  /**
   * Relee el producto del servidor (CAOS-04). Con ella, cada apertura de la
   * confirmación espera el precio y el costo frescos y pinta el efecto con ellos;
   * sin ella se usan `currentCostRef` y `currentPriceRef` tal como llegan.
   */
  onRefreshProduct?: () => Promise<FreshProductPricing>;
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
 *
 * Efecto rancio (CAOS-04): la confirmación relee el producto al abrirse y avisa si
 * el precio o el costo ya no son los del formulario. El costo releído viaja como
 * `expectedCostRef` (el servidor responde 409 si cambió después). Para el precio
 * el endpoint no tiene un «valor esperado»: entre la relectura y el envío otro
 * cambio de precio puede entrar y quedar sustituido; el aviso de éxito lo dice
 * cuando el servidor devuelve un precio anterior distinto del mostrado.
 */
export function ProductDetailPriceChangeCard({
  categoryMarkupPct,
  currentCostRef,
  currentPriceRef,
  isSubmitting = false,
  onRefreshProduct,
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
  const { showToast } = useToast();
  // Lectura del producto de la confirmación abierta, y lo que mostraba el formulario al abrirla.
  const [freshRead, setFreshRead] = useState<FreshRead>({ status: "loading" });
  const [shownAtOpen, setShownAtOpen] = useState<FreshProductPricing | null>(null);
  // Solo cuenta la última relectura pedida.
  const freshReadSeqRef = useRef(0);
  const pricingOptions = getProductPricingOptions(pricing);

  // Tras cada cambio confirmado, el precio en edición se realinea con el
  // guardado y el motivo vuelve a proponerse. Con la confirmación abierta no: el
  // precio que el usuario está confirmando no se pisa con el releído.
  if (syncedPriceRef !== currentPriceRef && !isConfirmOpen) {
    setSyncedPriceRef(currentPriceRef);
    setPrice(currentPriceRef);
    setTypedReason(null);
    setShowPriceRequired(false);
    setSavedPriceRef(null);
  }

  // Con qué se pinta la confirmación: lo releído o, sin relectura, lo que llega por props.
  let confirmBase: FreshProductPricing | null = { currentCostRef, currentPriceRef };

  if (onRefreshProduct) {
    confirmBase = freshRead.status === "ready" ? freshRead.value : null;
  }

  const baseCostRef = (isConfirmOpen ? confirmBase?.currentCostRef : undefined) ?? currentCostRef;
  const basePriceRef =
    (isConfirmOpen ? confirmBase?.currentPriceRef : undefined) ?? currentPriceRef;
  const resultingPct =
    price === null || price === basePriceRef ? null : markupPct(baseCostRef, price);
  const suggestedReason = resultingPct === null ? "" : getMarginAdjustmentReason(resultingPct);
  const reason = typedReason ?? suggestedReason;
  const trimmedReason = reason.trim();
  const isBelowCost = price !== null && isPriceBelowCost(baseCostRef, price);
  const priceChangedWhileEditing =
    confirmBase !== null &&
    shownAtOpen !== null &&
    confirmBase.currentPriceRef !== shownAtOpen.currentPriceRef;
  const costChangedWhileEditing =
    confirmBase !== null &&
    shownAtOpen !== null &&
    confirmBase.currentCostRef !== shownAtOpen.currentCostRef;
  let confirmStatus: ConfirmActionStatus = "ready";
  let confirmStatusMessage: string | undefined;

  if (!confirmBase) {
    confirmStatus = freshRead.status === "error" ? "error" : "loading";
    confirmStatusMessage =
      confirmStatus === "error"
        ? "No se pudo comprobar el precio actual."
        : "Comprobando el precio actual…";
  } else if (price !== null && price === confirmBase.currentPriceRef) {
    confirmStatus = "blocked";
    confirmStatusMessage = `El precio ya es ${formatRefUsd(price)}: no hay nada que cambiar.`;
  }

  /**
   * Relee precio y costo para la confirmación; una lectura sin números válidos cuenta
   * como fallo. `silent` (tras un guardado rechazado): el efecto ya pintado sigue a la
   * vista mientras tanto y solo se sustituye si la relectura llega.
   */
  function readFreshProduct(silent = false) {
    if (!onRefreshProduct) {
      return;
    }

    const seq = freshReadSeqRef.current + 1;

    freshReadSeqRef.current = seq;
    if (!silent) {
      setFreshRead({ status: "loading" });
    }

    onRefreshProduct().then(
      (value) => {
        if (freshReadSeqRef.current !== seq) {
          return;
        }

        if (Number.isFinite(value.currentCostRef) && Number.isFinite(value.currentPriceRef)) {
          setFreshRead({ status: "ready", value });
        } else if (!silent) {
          setFreshRead({ status: "error" });
        }
      },
      () => {
        if (freshReadSeqRef.current === seq && !silent) {
          setFreshRead({ status: "error" });
        }
      },
    );
  }

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
    setShownAtOpen({ currentCostRef, currentPriceRef });
    readFreshProduct();
    setIsConfirmOpen(true);
  }

  async function handleConfirm() {
    if (price === null || isSendingRef.current || !confirmBase || confirmStatus !== "ready") {
      return;
    }

    const shownPriceRef = confirmBase.currentPriceRef;

    isSendingRef.current = true;
    setConfirmError(null);

    try {
      const result = await onSubmit(price, trimmedReason, confirmBase.currentCostRef);
      const savedRef = typeof result?.salePriceRef === "number" ? result.salePriceRef : price;
      const replacedRef = result?.previousSalePriceRef;

      setSavedPriceRef(price);
      setIsConfirmOpen(false);
      showToast({
        description:
          typeof replacedRef === "number" && replacedRef !== shownPriceRef
            ? `Sustituyó a ${formatRefUsd(replacedRef)}, no a ${formatRefUsd(shownPriceRef)}: otro cambio de precio entró mientras confirmabas.`
            : undefined,
        title: `Precio actualizado: ${formatRefUsd(savedRef)}`,
        tone: "success",
      });
    } catch (error) {
      setConfirmError(
        error instanceof Error && error.message ? error.message : PRICE_UPDATE_FALLBACK_ERROR,
      );
      // El rechazo puede deberse a que el producto cambió (409 por costo): se relee.
      readFreshProduct(true);
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
            confirmBase
              ? `El precio${productName ? ` de ${productName}` : ""} pasa de ${formatRefUsd(basePriceRef)} a ${formatRefUsd(price)}.`
              : `Precio nuevo${productName ? ` de ${productName}` : ""}: ${formatRefUsd(price)}.`
          }
          error={confirmError}
          isPending={isSubmitting}
          onConfirm={handleConfirm}
          onOpenChange={setIsConfirmOpen}
          onRetry={() => readFreshProduct()}
          open={isConfirmOpen}
          renderEffects={() => (
            <PriceChangeEffect
              change={{ costRef: baseCostRef, fromPriceRef: basePriceRef, toPriceRef: price }}
              rateVes={rateVes}
              reason={trimmedReason}
              thresholds={pricingOptions.thresholds}
            />
          )}
          status={confirmStatus}
          statusHint={confirmStatus === "ready" ? undefined : "No se ha cambiado nada."}
          statusMessage={confirmStatusMessage}
          title="Confirmar cambio de precio"
          variant={isBelowCost ? "danger" : "default"}
        >
          {confirmStatus === "ready" && (priceChangedWhileEditing || costChangedWhileEditing) ? (
            <div className="space-y-1 font-medium text-foreground" role="status">
              {priceChangedWhileEditing ? (
                <p>El precio cambió mientras editabas: ahora es {formatRefUsd(basePriceRef)}.</p>
              ) : null}
              {costChangedWhileEditing ? (
                <p>El costo cambió mientras editabas: ahora es {formatRefUsd(baseCostRef)}.</p>
              ) : null}
            </div>
          ) : null}
        </ConfirmActionModal>
      ) : null}
    </section>
  );
}
