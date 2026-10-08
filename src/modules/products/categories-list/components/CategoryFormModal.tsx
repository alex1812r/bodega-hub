"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import type { CategoryInput } from "../../hooks/useProducts";
import { CategoryFormFields, readCategoryForm } from "./CategoryFormFields";

type CategoryFormModalProps = {
  category?: CategoryMock;
  errorMessage?: string;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onOpenChange?: (open: boolean) => void;
  /**
   * Guarda. En edición `taxRate` solo llega si el usuario eligió otra alícuota:
   * sin tocarla, la categoría conserva la que tenía.
   */
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

    await onSubmit?.(readCategoryForm(event.currentTarget));
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
        <CategoryFormFields category={category} errorMessage={errorMessage} />
      </form>
    </Modal>
  );
}
