"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import type { CategoryInput } from "../../hooks/useProducts";

type CategoryFormModalProps = {
  category?: CategoryMock;
  errorMessage?: string;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onOpenChange?: (open: boolean) => void;
  onSubmit?: (input: CategoryInput) => Promise<void> | void;
  open?: boolean;
  trigger?: ReactNode;
};

export function CategoryFormModal({
  category,
  errorMessage,
  isSubmitting = false,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  trigger,
}: CategoryFormModalProps) {
  const formId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const isEdit = mode === "edit";

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const taxRateRaw = String(formData.get("taxRate") ?? "").trim();
    const taxRate = taxRateRaw === "" ? 16 : Number(taxRateRaw);
    const input: CategoryInput = {
      description: String(formData.get("description") ?? "").trim() || undefined,
      name: String(formData.get("name") ?? "").trim(),
      taxRate: Number.isFinite(taxRate) ? Math.min(100, Math.max(0, taxRate)) : 16,
    };

    await onSubmit?.(input);
    handleOpenChange(false);
  }

  return (
    <Modal
      description={getFormSaveDescription()}
      footer={({ close }) => (
        <FormActions
          isSubmitting={isSubmitting}
          onCancel={close}
          submitFormId={formId}
          submitLabel={isEdit ? "Guardar cambios" : "Guardar"}
        />
      )}
      onOpenChange={handleOpenChange}
      open={isOpen}
      title={isEdit ? "Editar categoría" : "Nueva categoría"}
      trigger={trigger}
    >
      <form className="grid gap-4" id={formId} onSubmit={(event) => void handleSubmit(event)}>
        <Input
          defaultValue={category?.name}
          label="Nombre"
          name="name"
          required
        />
        <Input
          defaultValue={category?.taxRate ?? 16}
          helperText="Porcentaje de impuesto aplicable a productos de esta categoría (ej. 16 = IVA 16%)."
          label="Impuesto (%)"
          max={100}
          min={0}
          name="taxRate"
          required
          step="0.01"
          type="number"
        />
        <Textarea
          defaultValue={category?.description ?? ""}
          label="Descripción (opcional)"
          name="description"
          rows={3}
        />
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
