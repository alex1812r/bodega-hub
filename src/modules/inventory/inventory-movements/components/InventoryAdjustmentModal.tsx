"use client";

import { type FormEvent, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";

import {
  useAdjustInventory,
  useInventory,
  type InventoryAdjustmentType,
} from "../../hooks/useInventory";

const formId = "inventory-adjustment-form";

const adjustmentTypes: Array<{
  label: string;
  value: InventoryAdjustmentType;
}> = [
  { label: "Entrada", value: "ajuste_entrada" },
  { label: "Salida", value: "ajuste_salida" },
  { label: "Devolucion de cliente", value: "devolucion_cliente" },
  { label: "Devolucion a proveedor", value: "devolucion_proveedor" },
  { label: "Inventario inicial", value: "inventario_inicial" },
];

function getQuantityDelta(quantity: number, type: InventoryAdjustmentType) {
  const normalizedQuantity = Math.abs(quantity);

  if (type === "ajuste_salida" || type === "devolucion_proveedor") {
    return -normalizedQuantity;
  }

  return normalizedQuantity;
}

export function InventoryAdjustmentModal() {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<InventoryAdjustmentType>("ajuste_entrada");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const productsQuery = useInventory();
  const adjustment = useAdjustInventory();
  const productOptions = useMemo(
    () =>
      getPaginatedItems(productsQuery.data).map((product) => ({
        label: `${product.name} (${product.sku})`,
        value: product.id,
      })),
    [productsQuery.data],
  );
  const quantityNumber = Number(quantity);
  const canSubmit = Boolean(productId) && quantityNumber > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);

    if (!canSubmit) {
      return;
    }

    try {
      await adjustment.mutateAsync({
        productId,
        quantityDelta: getQuantityDelta(quantityNumber, type),
        reason: reason.trim() || undefined,
        type,
      });
    } catch {
      return;
    }

    setProductId("");
    setType("ajuste_entrada");
    setQuantity("");
    setReason("");
    setHasSubmitted(false);
    setOpen(false);
  }

  return (
    <Modal
      description="Registro visual de movimientos manuales de stock."
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setHasSubmitted(false);
          adjustment.reset();
        }
      }}
      open={open}
      footer={({ close }) => (
        <FormActions
          isSubmitting={adjustment.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Registrar movimiento"
          submittingLabel="Registrando..."
        />
      )}
      title="Ajuste de inventario"
      trigger={
        <Button size="sm">
          Registrar ajuste
        </Button>
      }
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
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
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Tipo"
            onChange={(event) =>
              setType(event.target.value as InventoryAdjustmentType)
            }
            options={adjustmentTypes}
            placeholder="Selecciona tipo"
            value={type}
          />
          <Input
            error={
              hasSubmitted && quantityNumber <= 0
                ? "Indica una cantidad mayor a cero."
                : undefined
            }
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
          placeholder="Ej. ajuste por conteo fisico"
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
