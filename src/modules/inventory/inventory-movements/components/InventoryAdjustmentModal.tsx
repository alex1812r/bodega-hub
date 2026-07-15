"use client";

import { ArrowRight } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { cn } from "@/shared/utils/cn";

import {
  useAdjustInventory,
  useInventory,
  type InventoryAdjustmentType,
} from "../../hooks/useInventory";
import {
  getInventoryAdjustmentDelta,
  inventoryAdjustmentTypeOptions,
} from "../utils/movementTypeLabels";

const formId = "inventory-adjustment-form";

type InventoryAdjustmentModalProps = {
  defaultProductId?: string;
  trigger?: ReactNode;
};

export function InventoryAdjustmentModal({
  defaultProductId,
  trigger,
}: InventoryAdjustmentModalProps = {}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<InventoryAdjustmentType>("ajuste_entrada");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const productsQuery = useInventory({ limit: 100 });
  const adjustment = useAdjustInventory();
  const products = useMemo(
    () => getPaginatedItems(productsQuery.data),
    [productsQuery.data],
  );
  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        label: `${product.name} (${product.sku})`,
        value: product.id,
      })),
    [products],
  );
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId),
    [productId, products],
  );
  const quantityNumber = Number(quantity);
  const quantityDelta =
    quantityNumber > 0 ? getInventoryAdjustmentDelta(quantityNumber, type) : 0;
  const projectedStock =
    selectedProduct != null && quantityNumber > 0
      ? selectedProduct.currentStock + quantityDelta
      : undefined;
  const canSubmit = Boolean(productId) && quantityNumber > 0;

  function resetForm() {
    setProductId(defaultProductId ?? "");
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

    try {
      await adjustment.mutateAsync({
        productId,
        quantityDelta,
        reason: reason.trim() || undefined,
        type,
      });
    } catch {
      return;
    }

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
        setOpen(nextOpen);

        if (nextOpen) {
          setHasSubmitted(false);
          adjustment.reset();
          setProductId(defaultProductId ?? "");
        } else {
          resetForm();
        }
      }}
      open={open}
      title="Ajuste de stock"
      trigger={
        trigger ?? (
          <Button size="sm">
            Registrar ajuste
          </Button>
        )
      }
    >
      <form className="grid gap-5" id={formId} onSubmit={handleSubmit}>
        <SelectField
          disabled={productsQuery.isLoading}
          error={hasSubmitted && !productId ? "Selecciona un producto." : undefined}
          helperText={
            productsQuery.error
              ? "No pudimos cargar los productos disponibles."
              : undefined
          }
          label="Producto"
          onChange={(event) => setProductId(event.target.value)}
          options={productOptions}
          placeholder="Selecciona producto"
          value={productId}
        />

        {selectedProduct != null ? (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              projectedStock != null && projectedStock < 0
                ? "border-error/30 bg-error/5 text-error"
                : "border-primary/20 bg-primary/5 text-foreground",
            )}
          >
            <p className="font-medium">
              Stock actual:{" "}
              <span className="tabular-nums">{selectedProduct.currentStock}</span>
            </p>
            {projectedStock != null ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-on-surface-variant">
                <span>Después del movimiento:</span>
                <ArrowRight aria-hidden className="size-4 shrink-0" />
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    projectedStock < 0 && "text-error",
                  )}
                >
                  {projectedStock}
                </span>
                {projectedStock < 0 ? (
                  <span className="text-error">(stock insuficiente)</span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2 md:items-start">
          <SelectField
            label="Tipo de movimiento"
            onChange={(event) =>
              setType(event.target.value as InventoryAdjustmentType)
            }
            options={inventoryAdjustmentTypeOptions}
            placeholder="Selecciona tipo"
            value={type}
          />
          <Input
            error={
              hasSubmitted && quantityNumber <= 0
                ? "Indica una cantidad mayor a cero."
                : undefined
            }
            helperText="Cantidad absoluta; el signo depende del tipo."
            label="Cantidad"
            min={1}
            onChange={(event) => setQuantity(event.target.value)}
            type="number"
            value={quantity}
          />
        </div>

        <Textarea
          label="Motivo"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ej. ajuste por conteo físico"
          value={reason}
        />

        {adjustment.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {adjustment.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
