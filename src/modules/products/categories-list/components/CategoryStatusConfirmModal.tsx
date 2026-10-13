"use client";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { useDeleteCategory, useProducts, useUpdateCategory } from "../../hooks/useProducts";

export type CategoryStatusAction = "deactivate" | "reactivate";

type CategoryStatusConfirmModalProps = {
  action: CategoryStatusAction;
  category: CategoryMock | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

type CategoryProductCounts = {
  active: number;
  total: number;
};

function pluralizeProducts(count: number) {
  return count === 1 ? "1 producto" : `${count} productos`;
}

function formatProductCounts({ active, total }: CategoryProductCounts) {
  if (total === 0) {
    return "Ninguno";
  }

  return `${pluralizeProducts(total)} (${active} ${active === 1 ? "activo" : "activos"})`;
}

/**
 * Lo que hace de verdad el servidor: solo cambia `categories.is_active`. Los
 * productos no se tocan; la categoría sale (o vuelve) de los filtros y de los
 * selectores, que piden solo las activas, y una inactiva no se puede asignar.
 */
export function buildCategoryStatusEffects(
  action: CategoryStatusAction,
  counts: CategoryProductCounts,
): ConfirmActionEffect[] {
  const productsEffect: ConfirmActionEffect = {
    after: "Sin cambios",
    before: formatProductCounts(counts),
    label: "Productos de la categoría",
  };

  if (action === "reactivate") {
    return [
      { after: "Activa", before: "Inactiva", label: "Estado de la categoría", tone: "positive" },
      productsEffect,
      {
        after: "Vuelve a aparecer",
        label: "Filtro por categoría del POS, Productos e Inventario",
        tone: "positive",
      },
      {
        after: "Se puede elegir",
        label: "Selector de categoría al crear o editar productos",
        tone: "positive",
      },
    ];
  }

  let sellingLabel = "Ningún producto usa esta categoría";

  if (counts.total > 0) {
    sellingLabel =
      counts.active === 0
        ? "Sus productos ya están inactivos: no se venden, con o sin la categoría"
        : `${
            counts.active === 1
              ? "El producto activo sigue vendiéndose"
              : `Los ${counts.active} productos activos siguen vendiéndose`
          } en el POS con su precio y su stock, y conservan la categoría`;
  }

  return [
    { after: "Inactiva", before: "Activa", label: "Estado de la categoría", tone: "warning" },
    productsEffect,
    { label: sellingLabel },
    {
      after: "Deja de aparecer",
      label: "Filtro por categoría del POS, Productos e Inventario",
      tone: "warning",
    },
    {
      after: "No se puede elegir",
      label: "Selector de categoría al crear productos o al cambiar la de uno existente",
      tone: "warning",
    },
  ];
}

/**
 * Confirma desactivar o reactivar una categoría mostrando cuántos productos la
 * usan. El conteo se pide al abrir (`/api/products` con `categoryId` y
 * `limit=1`); si falla, no se puede confirmar a ciegas.
 */
export function CategoryStatusConfirmModal({
  action,
  category,
  onOpenChange,
  open,
}: CategoryStatusConfirmModalProps) {
  const categoryId = category?.id ?? "";
  const countOptions = { enabled: open && categoryId !== "", staleTime: 0 };
  const totalProducts = useProducts({ categoryId, limit: 1 }, countOptions);
  const activeProducts = useProducts({ categoryId, isActive: true, limit: 1 }, countOptions);
  const deactivateCategory = useDeleteCategory();
  const reactivateCategory = useUpdateCategory();
  const mutation = action === "deactivate" ? deactivateCategory : reactivateCategory;

  const countError = totalProducts.error ?? activeProducts.error;
  const counts =
    totalProducts.data && activeProducts.data
      ? { active: activeProducts.data.total, total: totalProducts.data.total }
      : null;
  // Con un conteo viejo en caché se espera al nuevo: el efecto es el de ahora.
  const isCounting = totalProducts.isFetching || activeProducts.isFetching;

  let status: "ready" | "loading" | "error" = "ready";

  if (countError) {
    status = "error";
  } else if (isCounting || !counts) {
    status = "loading";
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      deactivateCategory.reset();
      reactivateCategory.reset();
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (!category) {
      return;
    }

    if (action === "deactivate") {
      await deactivateCategory.mutateAsync(category.id);
    } else {
      await reactivateCategory.mutateAsync({ id: category.id, isActive: true });
    }

    handleOpenChange(false);
  }

  const isDeactivating = action === "deactivate";

  return (
    <ConfirmActionModal
      confirmLabel={isDeactivating ? "Desactivar categoría" : "Reactivar categoría"}
      description={
        isDeactivating
          ? "Solo cambia el estado de la categoría. Sus productos no se modifican."
          : "La categoría vuelve a estar disponible. Sus productos no se modifican."
      }
      effects={counts ? buildCategoryStatusEffects(action, counts) : undefined}
      error={mutation.error instanceof Error ? mutation.error.message : null}
      isPending={mutation.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      onRetry={() => {
        void totalProducts.refetch();
        void activeProducts.refetch();
      }}
      open={open}
      status={status}
      statusHint={status === "error" ? "No se ha cambiado nada." : undefined}
      statusMessage={
        status === "error"
          ? (countError?.message ?? null)
          : "Contando los productos de la categoría…"
      }
      title={isDeactivating ? "Desactivar categoría" : "Reactivar categoría"}
      variant={isDeactivating ? "danger" : "default"}
    >
      <p>
        Categoría: <span className="font-semibold text-foreground">{category?.name}</span>
      </p>
    </ConfirmActionModal>
  );
}
