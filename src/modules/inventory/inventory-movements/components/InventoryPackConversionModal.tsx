"use client";

import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";

import {
  useConvertPackToUnits,
  usePackConversions,
} from "../../hooks/useInventory";

const formId = "inventory-pack-conversion-form";

type InventoryPackConversionModalProps = {
  defaultPackProductId?: string;
  trigger?: ReactNode;
};

export function InventoryPackConversionModal({
  defaultPackProductId,
  trigger,
}: InventoryPackConversionModalProps = {}) {
  const [open, setOpen] = useState(false);
  const [packProductId, setPackProductId] = useState("");
  const [packQuantity, setPackQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const packConversionsQuery = usePackConversions();
  const convert = useConvertPackToUnits();

  const packOptions = useMemo(
    () =>
      (packConversionsQuery.data ?? []).map((item) => ({
        label: `${item.packProduct.name} → ${item.linkedProduct.name} (x${item.unitsPerPack})`,
        value: item.packProduct.id,
      })),
    [packConversionsQuery.data],
  );

  const selected = useMemo(
    () =>
      (packConversionsQuery.data ?? []).find(
        (item) => item.packProduct.id === packProductId,
      ),
    [packConversionsQuery.data, packProductId],
  );

  const quantityNumber = Number(packQuantity);
  const unitPreview =
    selected && quantityNumber > 0 ? quantityNumber * selected.unitsPerPack : 0;
  const canSubmit =
    Boolean(selected) &&
    quantityNumber > 0 &&
    quantityNumber <= (selected?.packProduct.currentStock ?? 0);

  function resetForm() {
    setPackProductId(defaultPackProductId ?? "");
    setPackQuantity("1");
    setReason("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    try {
      await convert.mutateAsync({
        packProductId,
        packQuantity: quantityNumber,
        reason: reason.trim() || undefined,
      });
      resetForm();
      setOpen(false);
    } catch {
      return;
    }
  }

  return (
    <Modal
      contentClassName="sm:max-w-lg"
      description="Convierte empaques cerrados en unidades sueltas con movimiento de inventario emparejado."
      footer={({ close }) => (
        <FormActions
          isSubmitting={convert.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Convertir empaque"
          submittingLabel="Convirtiendo..."
        />
      )}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          convert.reset();
          setPackProductId(defaultPackProductId ?? "");
        } else {
          resetForm();
        }
      }}
      open={open}
      title="Convertir empaque"
      trigger={
        trigger ?? (
          <Button size="sm" type="button" variant="outline">
            Convertir empaque
          </Button>
        )
      }
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        <SelectField
          label="Producto empaque"
          onChange={(event) => setPackProductId(event.target.value)}
          options={packOptions}
          placeholder={
            packConversionsQuery.isLoading ? "Cargando..." : "Selecciona un empaque vinculado"
          }
          value={packProductId}
        />
        {selected ? (
          <p className="text-sm text-on-surface-variant">
            Stock empaque: {selected.packProduct.currentStock}. Unidad:{" "}
            {selected.linkedProduct.name} (stock {selected.linkedProduct.currentStock}).
          </p>
        ) : null}
        <Input
          label="Cantidad de empaques"
          max={selected?.packProduct.currentStock}
          min={1}
          onChange={(event) => setPackQuantity(event.target.value)}
          required
          type="number"
          value={packQuantity}
        />
        <p className="text-sm text-on-surface-variant">
          Preview: −{quantityNumber || 0} empaque(s) / +{unitPreview} unidad(es).
        </p>
        <Textarea
          label="Motivo"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Opcional"
          value={reason}
        />
        {convert.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {convert.error instanceof Error
              ? convert.error.message
              : "No se pudo convertir el empaque."}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
