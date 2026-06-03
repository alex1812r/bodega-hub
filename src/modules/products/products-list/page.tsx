"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import Link from "next/link";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { apiFetch } from "@/shared/api/apiFetch";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import { formatRef } from "@/shared/utils/currency";

import {
  type ProductInput,
  type ProductsFilters,
  type ProductWithCategory,
  useCategories,
  productsQueryKeys,
  useCreateProduct,
  useProducts,
} from "../hooks/useProducts";
import { ProductFormModal } from "../product-details/components/ProductFormModal";

const columns: DataTableColumn<ProductWithCategory>[] = [
  {
    header: "Producto",
    hideInCard: true,
    key: "name",
    render: (product) => product.name,
  },
  {
    header: "Categoria",
    key: "category",
    render: (product) => product.category?.name ?? "Sin categoria",
    visibility: "md",
  },
  {
    header: "Costo ref",
    key: "currentCostRef",
    render: (product) => formatRef(product.currentCostRef),
    visibility: "lg",
  },
  {
    header: "Precio ref",
    key: "salePriceRef",
    render: (product) => formatRef(product.salePriceRef),
  },
  {
    header: "Estado",
    key: "status",
    render: (product) => (
      <Badge variant={product.isActive ? "success" : "default"}>
        {product.isActive ? "activo" : "inactivo"}
      </Badge>
    ),
  },
];

export function ProductsListPage() {
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const [filters, setFilters] = useState<
    Pick<ProductsFilters, "categoryId" | "isActive" | "search">
  >({});
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.search,
    filters.categoryId,
    filters.isActive,
  ]);
  const products = useProducts({ ...filters, limit, skip });
  const categories = useCategories();
  const createProduct = useCreateProduct();

  async function handleCreateProduct(input: ProductInput) {
    await createProduct.mutateAsync(input);
  }

  return (
    <EntityListPage
      actions={
        <Can permission="products.manage">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/products/import">Importar Excel</Link>
            </Button>
            <ProductFormModal
              categories={getPaginatedItems(categories.data)}
              errorMessage={createProduct.error?.message}
              isSubmitting={createProduct.isPending}
              onSubmit={handleCreateProduct}
            />
          </div>
        </Can>
      }
      description={`Listado de productos ${getConnectedToApiPhrase()} con costo, precio de venta y estado.`}
      title="Productos"
    >
      <FilterPanel>
        <Input
          label="Producto"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              search: event.target.value || undefined,
            }))
          }
          placeholder="Buscar producto"
          value={filters.search ?? ""}
        />
        <SelectField
          label="Categoria"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              categoryId: event.target.value || undefined,
            }))
          }
          options={getPaginatedItems(categories.data).map((category) => ({
            label: category.name,
            value: category.id,
          }))}
          placeholder="Todas"
          value={filters.categoryId ?? ""}
        />
        <SelectField
          label="Estado"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              isActive: event.target.value || undefined,
            }))
          }
          options={[
            { label: "Activo", value: "true" },
            { label: "Inactivo", value: "false" },
          ]}
          placeholder="Todos"
          value={String(filters.isActive ?? "")}
        />
      </FilterPanel>

      <DataTable
        cardSubtitle={(product) => product.category?.name ?? "Sin categoria"}
        cardTitle={(product) => product.name}
        actions={(product) => {
          const items: ActionMenuItem[] = [
            { href: `/products/${product.id}`, label: "Ver detalle" },
            { href: `/products/${product.id}`, label: "Editar" },
            { href: `/products/${product.id}`, label: "Historial de precios" },
          ];

          if (product.isActive && can("products.manage")) {
            items.push({
              label: "Desactivar",
              onSelect: () => {
                void apiFetch(`/api/products/${product.id}`, {
                  body: { isActive: false },
                  method: "PATCH",
                }).then(() => {
                  void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
                });
              },
              variant: "danger" as const,
            });
          }

          return items;
        }}
        columns={columns}
        data={getPaginatedItems(products.data)}
        error={products.error}
        getRowId={(product) => product.id}
        isFetching={products.isFetching}
        isLoading={products.isLoading}
        onRetry={() => void products.refetch()}
      />
      <ResponsivePagination
        isDisabled={products.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={products.data?.skip ?? skip}
        total={products.data?.total ?? 0}
      />
    </EntityListPage>
  );
}
