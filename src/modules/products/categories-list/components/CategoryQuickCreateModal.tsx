"use client";

import { type FormEvent, useId, useRef } from "react";

import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { useCreateCategory } from "../../hooks/useProducts";
import { CategoryFormFields, readCategoryForm } from "./CategoryFormFields";

type CategoryQuickCreateModalProps = {
  /** Categoría ya guardada, justo antes de cerrar. */
  onCreated: (category: CategoryMock) => void;
  /** Solo recibe `false`: el modal pide cerrarse (cancelado, Escape o categoría creada). */
  onOpenChange: (open: boolean) => void;
};

/**
 * Alta rápida de categoría (Nombre + alícuota de IVA) para crearla sin salir
 * del formulario de producto. Se monta solo mientras está abierta y FUERA del
 * `<form>` que la abre: su envío no debe burbujear al de ese formulario.
 *
 * Guarda con `useCreateCategory`, que refresca las listas de categorías. Si el
 * servidor rechaza el alta (p. ej. nombre repetido), el motivo se muestra aquí
 * y el modal sigue abierto.
 */
export function CategoryQuickCreateModal({
  onCreated,
  onOpenChange,
}: CategoryQuickCreateModalProps) {
  const formId = useId();
  const createCategory = useCreateCategory();
  // Candado propio: `isPending` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitInFlightRef.current) {
      return;
    }

    isSubmitInFlightRef.current = true;

    try {
      const category = await createCategory.mutateAsync(readCategoryForm(event.currentTarget));

      onCreated(category);
      onOpenChange(false);
    } catch {
      // El motivo queda en `createCategory.error` y se muestra en el formulario.
    } finally {
      isSubmitInFlightRef.current = false;
    }
  }

  return (
    <Modal
      footer={({ close }) => (
        <FormActions
          isSubmitting={createCategory.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Crear categoría"
        />
      )}
      onOpenChange={onOpenChange}
      open
      title="Nueva categoría"
    >
      <form className="grid gap-4" id={formId} onSubmit={(event) => void handleSubmit(event)}>
        <CategoryFormFields
          errorMessage={createCategory.error?.message}
          showDescription={false}
        />
      </form>
    </Modal>
  );
}
