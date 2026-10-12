"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import { useToast } from "@/shared/components/Toast";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { useCreateCategory } from "../../hooks/useProducts";
import { useRefreshCategories } from "../../hooks/useRefreshCategories";
import { cleanText } from "../../services/productText";
import {
  CATEGORY_NAME_TAKEN_MESSAGE,
  CategoryFormFields,
  isCategoryNameTaken,
  readCategoryForm,
} from "./CategoryFormFields";

const INACTIVE_NAME_TAKEN_HINT = "Está inactiva: reactívala desde Categorías.";

/**
 * La categoría que ya ocupa ese nombre. Se compara como el índice único del
 * servidor: nombre exacto (distingue mayúsculas) tras la limpieza que el
 * servidor aplica al guardarlo (`cleanText`). Si hay una activa, gana.
 */
async function findCategoryByName(name: string) {
  const matches = (
    await fetchAllPaginatedItems<CategoryMock>("/api/categories", { isActive: "all", search: name })
  ).filter((category) => category.name === name);

  return matches.find((category) => category.isActive) ?? matches[0] ?? null;
}

type CategoryQuickCreateModalProps = {
  /**
   * Categoría que queda elegida, justo antes de cerrar: la recién guardada o, si
   * el nombre ya lo tenía una activa (la creó otro usuario), esa.
   */
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
 * servidor rechaza el alta, el motivo se muestra aquí y el modal sigue abierto.
 *
 * Nombre repetido (409): se refrescan las listas y se busca la categoría que lo
 * tiene. Si está activa se entrega por `onCreated`, el modal se cierra y se
 * avisa con un Toast; si está inactiva o no se encuentra, el modal sigue abierto
 * con "Ya existe una categoría con ese nombre." (y que está inactiva, si lo está).
 */
export function CategoryQuickCreateModal({
  onCreated,
  onOpenChange,
}: CategoryQuickCreateModalProps) {
  const formId = useId();
  const createCategory = useCreateCategory();
  const refreshCategories = useRefreshCategories();
  const { showToast } = useToast();
  // Estado propio y no el de la mutación: el envío incluye buscar la categoría
  // que ya tenía el nombre, y hasta entonces no hay error que mostrar.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  // Candado propio: el estado llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitInFlightRef.current) {
      return;
    }

    const input = readCategoryForm(event.currentTarget);

    isSubmitInFlightRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(undefined);

    try {
      const category = await createCategory.mutateAsync(input);

      onCreated(category);
      onOpenChange(false);
    } catch (error) {
      if (!isCategoryNameTaken(error)) {
        setErrorMessage(
          error instanceof Error && error.message ? error.message : "No se pudo crear la categoría.",
        );

        return;
      }

      // Otro la creó con este formulario abierto: las listas ya no están al día.
      refreshCategories();

      // Si la búsqueda falla se trata como no encontrada: queda el aviso de nombre repetido.
      const existing = await findCategoryByName(cleanText(input.name ?? "")).catch(() => null);

      if (!existing?.isActive) {
        setErrorMessage(
          existing
            ? `${CATEGORY_NAME_TAKEN_MESSAGE} ${INACTIVE_NAME_TAKEN_HINT}`
            : CATEGORY_NAME_TAKEN_MESSAGE,
        );

        return;
      }

      onCreated(existing);
      onOpenChange(false);
      showToast({
        title: `La categoría «${existing.name}» ya existía; quedó seleccionada`,
        tone: "info",
      });
    } finally {
      isSubmitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      footer={({ close }) => (
        <FormActions
          isSubmitting={isSubmitting}
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
        <CategoryFormFields errorMessage={errorMessage} showDescription={false} />
      </form>
    </Modal>
  );
}
