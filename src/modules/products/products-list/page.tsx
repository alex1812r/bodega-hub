"use client";

import { Plus, Tags, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getPaginatedItems } from "@/lib/api/pagination";
import { InventorySkuCell } from "@/modules/inventory/inventory-list/components/InventorySkuCell";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { ResponsivePagination, usePaginationState, useSortState } from "@/shared/components/Pagination";
import { amountWithTax } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { ProductFormModal } from "../product-details/components/ProductFormModal";
import type { ProductFormSubmitContext } from "../product-details/components/ProductFormModal";
import { uploadProductImageBlob } from "../services/uploadProductImage";
import {
  type ProductInput,
  type ProductsFilters,
  type ProductWithCategory,
  productsQueryKeys,
  useCategories,
  useCreateProduct,
  useProduct,
  useProducts,
  useUpdateProduct,
  useUpdateProductPrice,
} from "../hooks/useProducts";
import { DeactivateProductConfirmModal } from "./components/DeactivateProductConfirmModal";
import { ProductMoneyCell } from "./components/ProductMoneyCell";
import { ProductNameWithThumb } from "./components/ProductNameWithThumb";
import { ReactivateProductConfirmModal } from "./components/ReactivateProductConfirmModal";
import { ProductsListFilters } from "./components/ProductsListFilters";
import { ProductsStatusBadge } from "./components/ProductsStatusBadge";

const skuHeaderClass = "w-[5.75rem] max-w-[5.75rem]";
const skuCellClass = "min-w-0 w-[5.75rem] max-w-[5.75rem] overflow-hidden";

function isLowStock(product: ProductWithCategory) {
  return product.isActive && product.currentStock > 0 && product.currentStock <= product.minStock;
}

function buildProductColumns(rateVes: number): DataTableColumn<ProductWithCategory>[] {
  return [
    {
      cellClassName: skuCellClass,
      className: skuHeaderClass,
      header: "SKU",
      hideInCard: true,
      key: "sku",
      render: (product) => <InventorySkuCell sku={product.sku} />,
      sortable: true,
    },
    {
      cellClassName: "min-w-[10rem] font-medium",
      header: "Nombre",
      key: "name",
      render: (product) => (
        <ProductNameWithThumb
          imageUrl={product.imageUrl}
          isActive={product.isActive}
          name={product.name}
        />
      ),
      sortable: true,
    },
    {
      cellClassName: "text-on-surface-variant",
      header: "Categoría",
      key: "category",
      render: (product) => product.category?.name ?? "Sin categoría",
      sortable: true,
      sortKey: "category",
      visibility: "md",
    },
    {
      align: "right",
      cellClassName: "min-w-[7.5rem]",
      header: "Costo c/imp.",
      key: "currentCostRef",
      render: (product) => {
        const taxRate = product.taxRate ?? product.category?.taxRate ?? 0;
        return (
          <ProductMoneyCell
            isActive={product.isActive}
            rateVes={rateVes}
            refAmount={amountWithTax(product.currentCostRef, taxRate)}
          />
        );
      },
      sortable: true,
      visibility: "lg",
    },
    {
      align: "right",
      cellClassName: "min-w-[7.5rem]",
      header: "PVP",
      key: "salePriceRef",
      render: (product) => (
        <ProductMoneyCell
          isActive={product.isActive}
          rateVes={rateVes}
          refAmount={product.salePriceRef}
        />
      ),
      sortable: true,
    },
    {
      align: "right",
      cellClassName: "tabular-nums",
      header: "Stock",
      key: "currentStock",
      render: (product) => (
        <span
          className={cn(
            !product.isActive && "text-outline",
            product.currentStock === 0 && product.isActive && "font-medium text-destructive",
            isLowStock(product) && "font-medium text-destructive",
          )}
        >
          {product.currentStock} un
        </span>
      ),
      sortable: true,
    },
    {
      align: "center",
      header: "Estado",
      key: "status",
      render: (product) => (
        <div className="flex justify-center">
          <ProductsStatusBadge isActive={product.isActive} />
        </div>
      ),
      sortable: true,
      sortKey: "status",
    },
  ];
}

export function ProductsListPage() {
  const { can } = usePermission();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<
    Pick<ProductsFilters, "categoryId" | "isActive" | "search">
  >({});
  const [productToDeactivate, setProductToDeactivate] = useState<ProductWithCategory | null>(null);
  const [productToReactivate, setProductToReactivate] = useState<ProductWithCategory | null>(null);
  const [productToEditId, setProductToEditId] = useState<string | null>(null);
  const { handleSort, sortBy, sortOrder } = useSortState();
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.search,
    filters.categoryId,
    filters.isActive,
    sortBy,
    sortOrder,
  ]);
  const products = useProducts({ ...filters, limit, skip, sortBy, sortOrder });
  const categories = useCategories();
  const currentRate = useCurrentExchangeRate();
  const rateVes = currentRate.data?.rateVes ?? 0;
  const columns = useMemo(() => buildProductColumns(rateVes), [rateVes]);
  const createProduct = useCreateProduct();
  const productToEditQuery = useProduct(productToEditId ?? "");
  const updateProduct = useUpdateProduct(productToEditId ?? "");
  const updateProductPrice = useUpdateProductPrice(productToEditId ?? "");
  const productItems = getPaginatedItems(products.data);
  const totalProducts = products.data?.total ?? 0;
  const categoryOptions = getPaginatedItems(categories.data).map((category) => ({
    label: category.name,
    value: category.id,
  }));
  const editProductFallback = productItems.find((product) => product.id === productToEditId);
  const editProduct = productToEditQuery.data ?? editProductFallback;
  const isEditModalOpen = Boolean(productToEditId && editProduct);
  const isSavingEdit = updateProduct.isPending || updateProductPrice.isPending;

  function handleFilterChange(patch: Partial<ProductsFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  async function handleCreateProduct(input: ProductInput, context?: ProductFormSubmitContext) {
    const product = await createProduct.mutateAsync(input);

    if (context?.pendingImageBlob) {
      await uploadProductImageBlob(product.id, context.pendingImageBlob);
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    }
  }

  async function handleUpdateProduct(input: ProductInput) {
    if (!productToEditId || !editProduct) {
      return;
    }

    const { salePriceRef, ...productInput } = input;
    await updateProduct.mutateAsync(productInput);

    if (salePriceRef !== editProduct.salePriceRef) {
      await updateProductPrice.mutateAsync({ salePriceRef });
    }

    setProductToEditId(null);
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <Button asChild className="w-full gap-2 sm:w-auto" size="sm" variant="outline">
              <Link href="/products/categories">
                <Tags aria-hidden className="size-[1.125rem]" />
                Categorías
              </Link>
            </Button>
            <Can permission="products.manage">
              <Button asChild className="w-full gap-2 sm:w-auto" size="sm" variant="outline">
                <Link href="/products/import">
                  <Upload aria-hidden className="size-[1.125rem]" />
                  Importar Excel
                </Link>
              </Button>
              <ProductFormModal
                categories={getPaginatedItems(categories.data)}
                errorMessage={createProduct.error?.message}
                isSubmitting={createProduct.isPending}
                onSubmit={handleCreateProduct}
                trigger={
                  <Button className="w-full gap-1 sm:w-auto" size="sm">
                    <Plus aria-hidden className="size-5" />
                    Nuevo producto
                  </Button>
                }
              />
            </Can>
          </div>
        }
        description="Gestiona tu catálogo, inventario y precios."
        layout="sections"
        title="Productos"
      >
        <ProductsListFilters
          categoryOptions={categoryOptions}
          filters={filters}
          onChange={handleFilterChange}
        />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(product) => {
              const items: ActionMenuItem[] = [
                { href: `/products/${product.id}`, label: "Ver detalle" },
              ];

              if (can("products.manage")) {
                items.push({
                  label: "Editar",
                  onSelect: () => setProductToEditId(product.id),
                });
              }

              items.push({
                href: `/products/${product.id}`,
                label: "Historial de precios",
              });

              if (can("products.manage")) {
                if (product.isActive) {
                  items.push({
                    label: "Desactivar",
                    onSelect: () => setProductToDeactivate(product),
                    variant: "danger",
                  });
                } else {
                  items.push({
                    label: "Reactivar",
                    onSelect: () => setProductToReactivate(product),
                  });
                }
              }

              return items;
            }}
            cardSubtitle={(product) => product.category?.name ?? "Sin categoría"}
            cardTitle={(product) => (
              <ProductNameWithThumb
                imageUrl={product.imageUrl}
                isActive={product.isActive}
                name={product.name}
              />
            )}
            columns={columns}
            data={productItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="products.manage">
                    <ProductFormModal
                      categories={getPaginatedItems(categories.data)}
                      errorMessage={createProduct.error?.message}
                      isSubmitting={createProduct.isPending}
                      onSubmit={handleCreateProduct}
                      trigger={
                        <Button className="gap-1" size="sm">
                          <Plus aria-hidden className="size-5" />
                          Nuevo producto
                        </Button>
                      }
                    />
                  </Can>
                }
                description="Crea un producto o ajusta los filtros para ver otros resultados."
                title="No hay productos para mostrar"
              />
            }
            error={products.error ?? createProduct.error}
            getRowId={(product) => product.id}
            isFetching={products.isFetching}
            isLoading={products.isLoading}
            onRetry={() => void products.refetch()}
            onSortChange={handleSort}
            sortBy={sortBy}
            sortOrder={sortOrder}
            variant="stitch-purchases"
          />

          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="productos"
              isDisabled={products.isFetching}
              limit={limit}
              onLimitChange={setLimit}
              onSkipChange={setSkip}
              skip={products.data?.skip ?? skip}
              total={totalProducts}
              variant="stitch"
            />
          </div>
        </div>
      </EntityListPage>

      <DeactivateProductConfirmModal
        onOpenChange={(open) => {
          if (!open) {
            setProductToDeactivate(null);
          }
        }}
        open={productToDeactivate != null}
        product={productToDeactivate}
      />
      <ReactivateProductConfirmModal
        onOpenChange={(open) => {
          if (!open) {
            setProductToReactivate(null);
          }
        }}
        open={productToReactivate != null}
        product={productToReactivate}
      />
      {editProduct ? (
        <ProductFormModal
          categories={getPaginatedItems(categories.data)}
          errorMessage={updateProduct.error?.message ?? updateProductPrice.error?.message}
          isSubmitting={isSavingEdit}
          key={
            productToEditQuery.data
              ? `detail-${productToEditQuery.data.id}`
              : `list-${editProduct.id}`
          }
          mode="edit"
          onImageUpdated={() => void productToEditQuery.refetch()}
          onOpenChange={(open) => {
            if (!open) {
              setProductToEditId(null);
            }
          }}
          onSubmit={handleUpdateProduct}
          open={isEditModalOpen}
          product={editProduct}
        />
      ) : null}
    </div>
  );
}
