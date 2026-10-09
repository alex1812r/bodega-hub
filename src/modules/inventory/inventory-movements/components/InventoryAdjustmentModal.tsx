"use client";

import { ArrowRight } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button } from "@/shared/components/Button";
import { type ConfirmActionEffect, ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import {
  EntityAutocomplete,
  type ProductEntityFilters,
} from "@/shared/components/EntityAutocomplete";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { ProcessGuardModal } from "@/shared/components/ProcessGuard";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { useFormModalDiscardGuard } from "@/shared/hooks/useFormModalDiscardGuard";
import { cn } from "@/shared/utils/cn";

import {
  type InventoryItem,
  useAdjustInventory,
  useInventoryProduct,
} from "../../hooks/useInventory";
import { useReleaseAttemptOnClose, useRequestAttempt } from "../../utils/requestAttempt";
import {
  STOCK_REASON_MAX_LENGTH,
  describeStockReasonLength,
  trimStockReason,
} from "../../utils/stockReason";
import { describeStockRequestError } from "../../utils/stockRequestError";
import {
  getInventoryAdjustmentDelta,
  getMovementTypeLabel,
  inventoryAdjustmentTypeOptions,
  type FreeInventoryAdjustmentType,
} from "../utils/movementTypeLabels";
import {
  computeStockAdjustmentEffect,
  type StockAdjustmentEffect,
} from "../utils/stockAdjustmentEffect";

const formId = "inventory-adjustment-form";

const DEFAULT_ADJUSTMENT_TYPE: FreeInventoryAdjustmentType = "ajuste_entrada";

/** Mayor cantidad de un ajuste: por encima es un error de tecleo (la base guarda un `integer`). */
const MAX_ADJUSTMENT_QUANTITY = 999_999;

/** El ajuste libre solo se ofrece sobre productos activos, como la lista de inventario. */
const searchFilters: ProductEntityFilters = { active: true };

/** Producto fijo del ajuste: lo que el modal muestra de él sin consultar el catálogo. */
export type InventoryAdjustmentLockedProduct = Pick<
  InventoryItem,
  "currentStock" | "id" | "name" | "sku"
>;

type InventoryAdjustmentModalProps = {
  /**
   * Producto precargado en el buscador (se lee por id, sin pedir el catálogo);
   * el usuario puede cambiarlo. Un producto inactivo no se precarga.
   */
  defaultProductId?: string;
  /**
   * Ajuste de un producto concreto: se muestra bloqueado, sin buscador y sin
   * ninguna petición. Su `currentStock` es el que pinta "Stock actual".
   */
  lockedProduct?: InventoryAdjustmentLockedProduct;
  /** Avisa de cada apertura y cierre, también del cierre tras registrar el ajuste. */
  onOpenChange?: (open: boolean) => void;
  /** Modo controlado. Sin `open`, el modal se abre con `trigger` (o su botón por defecto). */
  open?: boolean;
  trigger?: ReactNode;
};

type AdjustmentStockPreviewProps = {
  /** Con `delta` 0 (aún sin una cantidad mayor a cero) solo se pinta el stock actual. */
  effect: StockAdjustmentEffect;
};

function AdjustmentStockPreview({ effect }: AdjustmentStockPreviewProps) {
  const currentStock = effect.stockBefore;
  const projectedStock = effect.delta !== 0 ? effect.stockAfter : undefined;

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        projectedStock != null && projectedStock < 0
          ? "border-error/30 bg-error/5 text-error"
          : "border-primary/20 bg-primary/5 text-foreground",
      )}
    >
      <p className="font-medium">
        Stock actual: <span className="tabular-nums">{currentStock}</span>
      </p>
      {projectedStock != null ? (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-on-surface-variant">
          <span>Después del movimiento:</span>
          <ArrowRight aria-hidden className="size-4 shrink-0" />
          <span
            className={cn("font-semibold tabular-nums", projectedStock < 0 && "text-error")}
          >
            {projectedStock}
          </span>
          {projectedStock < 0 ? <span className="text-error">(stock insuficiente)</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/** "+3 Cable HDMI" o "−4 Cable HDMI", con el stock antes → después. */
export function buildStockAdjustmentConfirmEffects(
  productName: string,
  effect: StockAdjustmentEffect,
): ConfirmActionEffect[] {
  const isEntry = effect.delta > 0;

  return [
    {
      after: String(effect.stockAfter),
      before: `Stock ${effect.stockBefore}`,
      label: `${isEntry ? "+" : "−"}${Math.abs(effect.delta)} ${productName}`,
      tone: isEntry ? "positive" : "warning",
    },
  ];
}

/**
 * Ajuste manual de stock: el formulario no envía, abre la confirmación con el
 * efecto sobre el stock.
 *
 * Si el usuario cambió algo respecto a como abrió el modal (otro producto, tipo,
 * cantidad o motivo), cerrar (Esc, clic fuera, Cancelar, la X) o salir de la
 * pantalla pregunta antes con el guardia de proceso; sin cambios, o tras
 * registrar el ajuste, cierra sin preguntar. El producto precargado no cuenta.
 */
export function InventoryAdjustmentModal({
  defaultProductId,
  lockedProduct,
  onOpenChange,
  open: openProp,
  trigger,
}: InventoryAdjustmentModalProps = {}) {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? openProp : internalOpen;
  const [pickedProduct, setPickedProduct] = useState<InventoryAdjustmentLockedProduct | null>(null);
  // Hasta que el usuario elige o limpia el campo manda el producto precargado.
  const [usesDefaultProduct, setUsesDefaultProduct] = useState(true);
  const defaultProductQuery = useInventoryProduct(
    defaultProductId,
    open && !lockedProduct && usesDefaultProduct,
  );
  const defaultProduct = defaultProductQuery.data?.isActive ? defaultProductQuery.data : null;
  const selectedProduct =
    lockedProduct ?? (usesDefaultProduct ? defaultProduct : pickedProduct) ?? null;
  const productId = selectedProduct?.id ?? "";
  const [type, setType] = useState<FreeInventoryAdjustmentType>(DEFAULT_ADJUSTMENT_TYPE);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previousOpen, setPreviousOpen] = useState(open);
  const adjustment = useAdjustInventory();
  const requestAttempt = useRequestAttempt({ lockAfterSuccess: true, renewOnContentChange: true });
  // Tras el éxito no sale otro ajuste hasta que el modal se cierre (INT-02).
  useReleaseAttemptOnClose(requestAttempt, open);
  const quantityNumber = Number(quantity);
  const quantityDelta =
    quantityNumber > 0 ? getInventoryAdjustmentDelta(quantityNumber, type) : 0;
  // Con decimales el propio campo avisa ("Debe ser un número entero."): aquí solo se bloquea el envío.
  const isQuantityValid =
    quantityNumber > 0 &&
    quantityNumber <= MAX_ADJUSTMENT_QUANTITY &&
    Number.isInteger(quantityNumber);
  const effect = selectedProduct
    ? computeStockAdjustmentEffect({
        currentStock: selectedProduct.currentStock,
        delta: quantityDelta,
      })
    : null;
  // La base rechaza cualquier saldo negativo (PT409): la salida se frena antes de confirmar.
  const hasInsufficientStock = isQuantityValid && Boolean(effect?.wouldBeNegative);
  const trimmedReason = trimStockReason(reason);
  const canConfirm =
    Boolean(productId) && isQuantityValid && !hasInsufficientStock && trimmedReason !== "";
  // Elegir otro producto (o quitar el precargado) cuenta; volver al precargado, no.
  const hasChangedProduct =
    !lockedProduct &&
    !usesDefaultProduct &&
    (pickedProduct?.id ?? "") !== (defaultProduct?.id ?? "");
  const hasTypedData =
    hasChangedProduct ||
    type !== DEFAULT_ADJUSTMENT_TYPE ||
    quantity !== "" ||
    trimmedReason !== "";
  // Con el ajuste en vuelo no se pregunta: el cierre ya está bloqueado.
  const { guard, requestClose, trackFocus } = useFormModalDiscardGuard({
    active: open && hasTypedData && !adjustment.isPending,
    label: selectedProduct
      ? `Ajuste de stock de «${selectedProduct.name}» sin registrar`
      : "Ajuste de stock sin registrar",
  });

  // Quien controla el modal lo cerró con la confirmación abierta: no debe reaparecer al reabrir.
  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (!open) {
      setConfirmOpen(false);
    }
  }

  function setOpen(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  function resetProduct() {
    setPickedProduct(null);
    setUsesDefaultProduct(true);
  }

  function resetForm() {
    resetProduct();
    setType(DEFAULT_ADJUSTMENT_TYPE);
    setQuantity("");
    setReason("");
    setHasSubmitted(false);
  }

  /** El formulario no envía: abre la confirmación con el efecto del ajuste. */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);

    if (!canConfirm || adjustment.isPending) {
      return;
    }

    // Un error de un intento anterior no pertenece a esta confirmación.
    adjustment.reset();
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    if (!canConfirm) {
      return;
    }

    const input = {
      productId,
      quantityDelta,
      reason: trimmedReason,
      type,
    };
    // Clave de idempotencia del intento; null = ya hay un envio en vuelo (doble clic).
    const clientRequestId = requestAttempt.begin(input);

    if (!clientRequestId) {
      return;
    }

    try {
      await adjustment.mutateAsync({ ...input, clientRequestId });
    } catch (error) {
      requestAttempt.fail(error);
      return;
    }

    requestAttempt.succeed();

    setConfirmOpen(false);
    resetForm();
    setOpen(false);
  }

  return (
    <Modal
      contentClassName="sm:max-w-lg"
      description="Registra una entrada, salida o corrección manual sobre el stock de un producto."
      footer={({ close }) => (
        <FormActions
          isSubmitting={adjustment.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Continuar"
          submittingLabel="Registrando..."
        />
      )}
      onOpenChange={(nextOpen) => {
        // Con el ajuste en vuelo el modal no se cierra: su resultado llegaría sin formulario.
        if (!nextOpen && adjustment.isPending) {
          return;
        }

        if (nextOpen) {
          setOpen(true);
          setHasSubmitted(false);
          adjustment.reset();
          resetProduct();
          return;
        }

        // Con cambios pregunta antes de descartarlos.
        requestClose(() => {
          setOpen(false);
          setConfirmOpen(false);
          resetForm();
          // Cerrar descarta el intento: al reabrir, clave nueva y sin el error anterior.
          requestAttempt.discard();
          adjustment.reset();
        });
      }}
      open={open}
      title="Ajuste de stock"
      trigger={trigger ?? (isControlled ? undefined : <Button size="sm">Registrar ajuste</Button>)}
    >
      <form className="grid gap-5" id={formId} onFocus={trackFocus} onSubmit={handleSubmit}>
        {lockedProduct ? (
          <Input
            disabled
            label="Producto"
            readOnly
            value={`${lockedProduct.name} (${lockedProduct.sku})`}
          />
        ) : (
          <EntityAutocomplete
            disabled={defaultProductQuery.isLoading || adjustment.isPending}
            entity="product"
            error={hasSubmitted && !productId ? "Selecciona un producto." : undefined}
            filters={searchFilters}
            helperText={
              defaultProductQuery.isLoading
                ? "Cargando producto…"
                : usesDefaultProduct && defaultProductQuery.error
                  ? defaultProductQuery.error.message
                  : undefined
            }
            label="Producto"
            onChange={(option) => {
              setUsesDefaultProduct(false);
              setPickedProduct(
                option
                  ? {
                      currentStock: option.currentStock,
                      id: option.id,
                      name: option.label,
                      sku: option.sku,
                    }
                  : null,
              );
            }}
            // Sin recientes: son una copia del navegador y su stock puede estar desactualizado.
            recentsKey={null}
            value={
              selectedProduct
                ? { id: selectedProduct.id, label: `${selectedProduct.name} (${selectedProduct.sku})` }
                : null
            }
          />
        )}
        {effect ? <AdjustmentStockPreview effect={effect} /> : null}

        <div className="grid gap-5 md:grid-cols-2 md:items-start">
          <SelectField
            disabled={adjustment.isPending}
            label="Tipo de movimiento"
            onChange={(event) =>
              setType(event.target.value as FreeInventoryAdjustmentType)
            }
            options={inventoryAdjustmentTypeOptions}
            placeholder="Selecciona tipo"
            value={type}
          />
          <NumberInput
            decimals={0}
            disabled={adjustment.isPending}
            error={
              quantityNumber > MAX_ADJUSTMENT_QUANTITY
                ? "La cantidad máxima es 999.999."
                : hasSubmitted && quantityNumber <= 0
                  ? "Indica una cantidad mayor a cero."
                  : hasSubmitted && hasInsufficientStock
                    ? `Stock insuficiente: hay ${effect?.stockBefore ?? 0} en stock.`
                    : undefined
            }
            helperText="Cantidad absoluta; el signo depende del tipo."
            label="Cantidad"
            onChange={(event) => setQuantity(event.target.value)}
            value={quantity}
          />
        </div>

        <Textarea
          aria-required
          disabled={adjustment.isPending}
          error={hasSubmitted && trimmedReason === "" ? "Indica el motivo del ajuste." : undefined}
          helperText={describeStockReasonLength(reason)}
          label="Motivo"
          maxLength={STOCK_REASON_MAX_LENGTH}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ej. ajuste por conteo físico"
          value={reason}
        />

        {/* Con la confirmación abierta el error se dice en ella; al cancelarla sigue a la vista aquí. */}
        {adjustment.error && !confirmOpen ? (
          <p
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            role="alert"
          >
            {describeStockRequestError(adjustment.error)}
          </p>
        ) : null}
      </form>
      {selectedProduct && effect ? (
        <ConfirmActionModal
          confirmLabel="Registrar movimiento"
          description="Revisa el efecto sobre el stock antes de registrar el movimiento."
          effects={buildStockAdjustmentConfirmEffects(selectedProduct.name, effect)}
          error={adjustment.error ? describeStockRequestError(adjustment.error) : null}
          isPending={adjustment.isPending}
          onConfirm={handleConfirm}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setConfirmOpen(false);
            }
          }}
          // La pregunta del guardia (ATRÁS del navegador) no se apila sobre la confirmación.
          open={confirmOpen && !guard.dialog.open}
          title="Confirmar ajuste de stock"
        >
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>Producto</dt>
            <dd className="break-words font-medium text-foreground">
              {selectedProduct.name} ({selectedProduct.sku})
            </dd>
            <dt>Tipo</dt>
            <dd className="font-medium text-foreground">{getMovementTypeLabel(type)}</dd>
            <dt>Motivo</dt>
            <dd className="whitespace-pre-wrap break-words font-medium text-foreground">
              {trimmedReason}
            </dd>
          </dl>
        </ConfirmActionModal>
      ) : null}
      <ProcessGuardModal guard={guard} />
    </Modal>
  );
}
