"use client";

import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";

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
   * sin tocarla, la categoría conserva la que tenía. `defaultMarkupPct` llega
   * con el % escrito, o `null` si se borró el que tenía. Si rechaza, el modal
   * queda abierto (el consumidor muestra el motivo con `errorMessage`); el
   * rechazo se captura aquí.
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
  // Candado propio: `isSubmitting` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitInFlightRef.current) {
      return;
    }

    isSubmitInFlightRef.current = true;

    try {
      await onSubmit?.(readCategoryForm(event.currentTarget, isEdit ? category : undefined));
      handleOpenChange(false);
    } catch {
      // El modal sigue abierto; el consumidor muestra el motivo con `errorMessage`.
    } finally {
      isSubmitInFlightRef.current = false;
    }
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
