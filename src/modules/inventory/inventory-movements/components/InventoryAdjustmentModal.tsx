"use client";

import { ArrowRight } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button } from "@/shared/components/Button";
import {
  EntityAutocomplete,
  type ProductEntityFilters,
} from "@/shared/components/EntityAutocomplete";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { cn } from "@/shared/utils/cn";

import {
  type InventoryItem,
  useAdjustInventory,
  useInventoryProduct,
} from "../../hooks/useInventory";
import { useRequestAttempt } from "../../utils/requestAttempt";
import { describeStockRequestError } from "../../utils/stockRequestError";
import {
  getInventoryAdjustmentDelta,
  inventoryAdjustmentTypeOptions,
  type FreeInventoryAdjustmentType,
} from "../utils/movementTypeLabels";

const formId = "inventory-adjustment-form";

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
  currentStock: number;
  /** Con signo; 0 mientras no haya una cantidad mayor a cero. */
  quantityDelta: number;
};

function AdjustmentStockPreview({ currentStock, quantityDelta }: AdjustmentStockPreviewProps) {
  const projectedStock = quantityDelta !== 0 ? currentStock + quantityDelta : undefined;

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
  const [type, setType] = useState<FreeInventoryAdjustmentType>("ajuste_entrada");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const adjustment = useAdjustInventory();
  const requestAttempt = useRequestAttempt({ renewOnContentChange: true });
  const quantityNumber = Number(quantity);
  const quantityDelta =
    quantityNumber > 0 ? getInventoryAdjustmentDelta(quantityNumber, type) : 0;
  // Con decimales el propio campo avisa ("Debe ser un número entero."): aquí solo se bloquea el envío.
  const canSubmit =
    Boolean(productId) && quantityNumber > 0 && Number.isInteger(quantityNumber);

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
    setType("ajuste_entrada");
    setQuantity("");
    setReason("");
    setHasSubmitted(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);

    if (!canSubmit) {
      return;
    }

    const input = {
      productId,
      quantityDelta,
      reason: reason.trim() || undefined,
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
          submitLabel="Registrar movimiento"
          submittingLabel="Registrando..."
        />
      )}
      onOpenChange={(nextOpen) => {
        // Con el ajuste en vuelo el modal no se cierra: su resultado llegaría sin formulario.
        if (!nextOpen && adjustment.isPending) {
          return;
        }

        setOpen(nextOpen);

        if (nextOpen) {
          setHasSubmitted(false);
          adjustment.reset();
          resetProduct();
        } else {
          resetForm();
          // Cerrar descarta el intento: al reabrir, clave nueva y sin el error anterior.
          requestAttempt.discard();
          adjustment.reset();
        }
      }}
      open={open}
      title="Ajuste de stock"
      trigger={trigger ?? (isControlled ? undefined : <Button size="sm">Registrar ajuste</Button>)}
    >
      <form className="grid gap-5" id={formId} onSubmit={handleSubmit}>
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
        {selectedProduct ? (
          <AdjustmentStockPreview
            currentStock={selectedProduct.currentStock}
            quantityDelta={quantityDelta}
          />
        ) : null}

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
              hasSubmitted && quantityNumber <= 0
                ? "Indica una cantidad mayor a cero."
                : undefined
            }
            helperText="Cantidad absoluta; el signo depende del tipo."
            label="Cantidad"
            onChange={(event) => setQuantity(event.target.value)}
            value={quantity}
          />
        </div>

        <Textarea
          disabled={adjustment.isPending}
          label="Motivo"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ej. ajuste por conteo físico"
          value={reason}
        />

        {adjustment.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {describeStockRequestError(adjustment.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
