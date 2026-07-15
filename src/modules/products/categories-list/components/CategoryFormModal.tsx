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
    const input: CategoryInput = {
      description: String(formData.get("description") ?? "").trim() || undefined,
      name: String(formData.get("name") ?? "").trim(),
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
