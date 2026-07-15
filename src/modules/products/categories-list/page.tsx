"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import type { CategoryMock } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import { ProductsStatusBadge } from "../products-list/components/ProductsStatusBadge";
import { CategoriesListFilters } from "./components/CategoriesListFilters";
import { CategoryFormModal } from "./components/CategoryFormModal";
import {
  type CategoriesFilters,
  type CategoryInput,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "../hooks/useProducts";

const nameColumnClass = "min-w-[11rem] w-[11rem] max-w-[11rem]";

const columns: DataTableColumn<CategoryMock>[] = [
  {
    cellClassName: cn(nameColumnClass, "font-medium"),
    className: nameColumnClass,
    header: "Nombre",
    hideInCard: true,
    key: "name",
    render: (category) => (
      <span
        className={cn("block truncate", !category.isActive && "text-outline")}
        title={category.name}
      >
        {category.name}
      </span>
    ),
  },
  {
    cellClassName: "text-on-surface-variant",
    header: "Descripción",
    key: "description",
    render: (category) => (
      <span
        className={cn("line-clamp-2 min-w-0 text-sm", !category.isActive && "text-outline")}
        title={category.description}
      >
        {category.description?.trim() || "—"}
      </span>
    ),
  },
  {
    header: "Estado",
    key: "isActive",
    render: (category) => <ProductsStatusBadge isActive={category.isActive} />,
    visibility: "md",
  },
];

export function CategoriesListPage() {
  const { can } = usePermission();
  const [filters, setFilters] = useState<Pick<CategoriesFilters, "isActive" | "search">>({
    isActive: "all",
  });
  const [editingCategory, setEditingCategory] = useState<CategoryMock | null>(null);
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.search,
    filters.isActive,
  ]);
  const categories = useCategories({ ...filters, limit, skip });
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory(editingCategory?.id ?? "");
  const deleteCategory = useDeleteCategory();
  const categoryItems = getPaginatedItems(categories.data);
  const totalCategories = categories.data?.total ?? 0;

  function handleFilterChange(patch: Partial<CategoriesFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  async function handleCreateCategory(input: CategoryInput) {
    await createCategory.mutateAsync(input);
  }

  async function handleUpdateCategory(input: CategoryInput) {
    if (!editingCategory) {
      return;
    }

    await updateCategory.mutateAsync(input);
    setEditingCategory(null);
  }

  async function handleDeactivateCategory(category: CategoryMock) {
    const confirmed = window.confirm(
      "La categoría dejará de aparecer en selectores. Los productos que la usan no se modifican.",
    );

    if (!confirmed) {
      return;
    }

    await deleteCategory.mutateAsync(category.id);
  }

  async function handleReactivateCategory(category: CategoryMock) {
    const confirmed = window.confirm(
      "La categoría volverá a aparecer en selectores de producto y formularios.",
    );

    if (!confirmed) {
      return;
    }

    await updateCategory.mutateAsync({ id: category.id, isActive: true });
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <PageBackButton
              className="shrink-0"
              href="/products"
              label="Volver a productos"
              size="sm"
            />
            <Can permission="products.manage">
              <CategoryFormModal
                errorMessage={createCategory.error?.message}
                isSubmitting={createCategory.isPending}
                onSubmit={handleCreateCategory}
                trigger={
                  <Button className="w-full gap-2 sm:w-auto" size="sm">
                    <Plus aria-hidden className="size-5" />
                    Nueva categoría
                  </Button>
                }
              />
            </Can>
          </div>
        }
        description="Organiza el catálogo de productos."
        layout="sections"
        title="Categorías"
      >
        <CategoriesListFilters filters={filters} onChange={handleFilterChange} />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(category) => {
              if (!can("products.manage")) {
                return [];
              }

              const items: ActionMenuItem[] = [
                {
                  label: "Editar",
                  onSelect: () => setEditingCategory(category),
                },
              ];

              if (category.isActive) {
                items.push({
                  label: "Desactivar",
                  onSelect: () => {
                    void handleDeactivateCategory(category);
                  },
                  variant: "danger",
                });
              } else {
                items.push({
                  label: "Reactivar",
                  onSelect: () => {
                    void handleReactivateCategory(category);
                  },
                });
              }

              return items;
            }}
            cardSubtitle={(category) => category.description?.trim() || "Sin descripción"}
            cardTitle={(category) => category.name}
            columns={columns}
            data={categoryItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="products.manage">
                    <CategoryFormModal
                      errorMessage={createCategory.error?.message}
                      isSubmitting={createCategory.isPending}
                      onSubmit={handleCreateCategory}
                      trigger={
                        <Button className="gap-2" size="sm">
                          <Plus aria-hidden className="size-5" />
                          Nueva categoría
                        </Button>
                      }
                    />
                  </Can>
                }
                description="Crea una categoría o ajusta la búsqueda para ver otros resultados."
                title="No hay categorías para mostrar"
              />
            }
            error={
              categories.error ??
              createCategory.error ??
              deleteCategory.error ??
              updateCategory.error
            }
            getRowId={(category) => category.id}
            isFetching={categories.isFetching}
            isLoading={categories.isLoading}
            onRetry={() => void categories.refetch()}
            variant="stitch-purchases"
          />

          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="categorías"
              isDisabled={categories.isFetching}
              limit={limit}
              onLimitChange={setLimit}
              onSkipChange={setSkip}
              skip={categories.data?.skip ?? skip}
              total={totalCategories}
              variant="stitch"
            />
          </div>
        </div>
      </EntityListPage>

      {editingCategory ? (
        <CategoryFormModal
          category={editingCategory}
          errorMessage={updateCategory.error?.message}
          isSubmitting={updateCategory.isPending}
          mode="edit"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setEditingCategory(null);
            }
          }}
          onSubmit={handleUpdateCategory}
          open
          trigger={null}
        />
      ) : null}
    </div>
  );
}
