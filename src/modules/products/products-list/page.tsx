"use client";

import { Plus, Tags, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { MarginBadge } from "@/shared/components/MarginBadge";
import {
  ResponsivePagination,
  getTotalPages,
  useUrlPaginationState,
  useUrlSortState,
} from "@/shared/components/Pagination";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { cn } from "@/shared/utils/cn";
import { withReturnTo } from "@/shared/utils/returnTo";

import { ProductFormModal } from "../product-details/components/ProductFormModal";
import type { ProductFormSubmitContext } from "../product-details/components/ProductFormModal";
import { uploadProductImageBlob } from "../services/uploadProductImage";
import {
  type ProductInput,
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
import { AddProductBarcodeModal } from "./components/AddProductBarcodeModal";
import { ProductMoneyCell } from "./components/ProductMoneyCell";
import { ProductNameWithThumb } from "./components/ProductNameWithThumb";
import { ReactivateProductConfirmModal } from "./components/ReactivateProductConfirmModal";
import { ProductsListFilters } from "./components/ProductsListFilters";
import { ProductsStatusBadge } from "./components/ProductsStatusBadge";
import { PRODUCT_EDIT_PRICE_REASON } from "../services/productSchemas";
import { normalizeBarcode } from "../services/productSearch";
import { productsListSchema, toProductsFilters } from "./productsListParams";

/**
 * PRO-F2: con la columna "Ganancia" la tabla medía 1021 px y no cabía en los
 * ≈ 940 px que deja el menú lateral abierto a 1280 px (la columna de acciones
 * quedaba fuera de la vista). Las ocho columnas de datos llevan 8 px de padding
 * lateral en vez de 16 (la primera conserva 16 a la izquierda) y sus anchos
 * mínimos bajan lo mismo, así que el contenido de cada celda no pierde espacio:
 * SKU 84 · Nombre 144 · Categoría ≈ 105 · Costo 104 · PVP 104 · Ganancia ≈ 109 ·
 * Stock ≈ 73 · Estado ≈ 79 · Acciones ≈ 99 (de DataTable) = ≈ 901 px.
 */
const compactColumnClass = "px-2";
const skuHeaderClass = "w-[5.25rem] max-w-[5.25rem] px-2 pl-4";
const skuCellClass = "min-w-0 overflow-hidden";
const detailLinkClass =
  "block min-w-0 rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function isLowStock(product: ProductWithCategory) {
  return product.isActive && product.currentStock > 0 && product.currentStock <= product.minStock;
}

function ProductDetailLink({ href, product }: { href: string; product: ProductWithCategory }) {
  return (
    <Link className={detailLinkClass} href={href}>
      <ProductNameWithThumb
        imageUrl={product.imageUrl}
        isActive={product.isActive}
        name={product.name}
      />
    </Link>
  );
}

function buildProductColumns(
  rateVes: number,
  detailHref: (productId: string) => string,
): DataTableColumn<ProductWithCategory>[] {
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
      cellClassName: "min-w-[9rem] font-medium",
      className: compactColumnClass,
      header: "Nombre",
      hideInCard: true,
      key: "name",
      render: (product) => <ProductDetailLink href={detailHref(product.id)} product={product} />,
      sortable: true,
    },
    {
      cellClassName: "text-on-surface-variant",
      className: compactColumnClass,
      header: "Categoría",
      hideInCard: true,
      key: "category",
      render: (product) => product.category?.name ?? "Sin categoría",
      sortable: true,
      sortKey: "category",
      visibility: "md",
    },
    {
      align: "right",
      cellClassName: "min-w-[6.5rem]",
      className: compactColumnClass,
      header: "Costo",
      key: "currentCostRef",
      render: (product) => (
        <ProductMoneyCell
          isActive={product.isActive}
          rateVes={rateVes}
          // Costo final guardado en la ultima compra (neto + IVA de esa linea; 0% si exento).
          refAmount={product.currentCostRef}
        />
      ),
      sortable: true,
      visibility: "lg",
    },
    {
      align: "right",
      cellClassName: "min-w-[6.5rem]",
      className: compactColumnClass,
      header: "PVP",
      key: "salePriceRef",
      render: (product) => (
        <div className="flex items-center justify-end gap-2">
          {/* Por debajo de lg no hay columna "Ganancia": el semáforo va junto al precio. */}
          <MarginBadge
            className="lg:hidden"
            cost={product.currentCostRef}
            price={product.salePriceRef}
          />
          <ProductMoneyCell
            isActive={product.isActive}
            rateVes={rateVes}
            refAmount={product.salePriceRef}
          />
        </div>
      ),
      sortable: true,
    },
    {
      align: "right",
      className: compactColumnClass,
      header: "Ganancia",
      hideInCard: true,
      key: "marginPct",
      // currentCostRef ya incluye el IVA: el % se calcula sobre él tal cual.
      render: (product) => (
        <div className="flex justify-end">
          <MarginBadge cost={product.currentCostRef} price={product.salePriceRef} />
        </div>
      ),
      sortable: true,
      visibility: "lg",
    },
    {
      align: "right",
      cellClassName: "tabular-nums",
      className: compactColumnClass,
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
      className: compactColumnClass,
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

function ProductsList() {
  const { can } = usePermission();
  const queryClient = useQueryClient();
  const list = useUrlListState(productsListSchema);
  const [productToDeactivate, setProductToDeactivate] = useState<ProductWithCategory | null>(null);
  const [productToReactivate, setProductToReactivate] = useState<ProductWithCategory | null>(null);
  const [productToAddBarcode, setProductToAddBarcode] = useState<ProductWithCategory | null>(null);
  const [productToEditId, setProductToEditId] = useState<string | null>(null);
  const { handleSort, sortBy, sortOrder } = useUrlSortState(list);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const products = useProducts({
    ...toProductsFilters(list.state, debouncedSearch),
    limit,
    skip,
  });
  const categories = useCategories();
  const currentRate = useCurrentExchangeRate();
  const rateVes = currentRate.data?.rateVes ?? 0;
  // El detalle vuelve a esta URL exacta (filtros, orden y página) con "Volver".
  const listHref = list.href;
  const detailHref = useCallback(
    (productId: string) => withReturnTo(`/products/${productId}`, listHref),
    [listHref],
  );
  const columns = useMemo(() => buildProductColumns(rateVes, detailHref), [detailHref, rateVes]);
  const createProduct = useCreateProduct();
  const productToEditQuery = useProduct(productToEditId ?? "");
  const updateProduct = useUpdateProduct(productToEditId ?? "");
  const updateProductPrice = useUpdateProductPrice(productToEditId ?? "");
  const productItems = getPaginatedItems(products.data);
  const totalProducts = products.data?.total ?? 0;
  const { setState: setListState } = list;
  const lastPage = getTotalPages(totalProducts, limit);
  // `?page=9999`: con el total ya conocido, la página pedida no existe.
  const isPagePastTheEnd = products.data !== undefined && list.state.page > lastPage;

  // La lista acota la página contra su total y corrige la URL (regla 15).
  useEffect(() => {
    if (isPagePastTheEnd) {
      setListState({ page: lastPage });
    }
  }, [isPagePastTheEnd, lastPage, setListState]);
  const categoryOptions = getPaginatedItems(categories.data).map((category) => ({
    label: category.name,
    value: category.id,
  }));
  const editProductFallback = productItems.find((product) => product.id === productToEditId);
  const editProduct = productToEditQuery.data ?? editProductFallback;
  const isEditModalOpen = Boolean(productToEditId && editProduct);
  const isSavingEdit = updateProduct.isPending || updateProductPrice.isPending;

  async function handleCreateProduct(input: ProductInput, context?: ProductFormSubmitContext) {
    const product = await createProduct.mutateAsync(input);

    if (context?.pendingImageBlob) {
      await uploadProductImageBlob(product.id, context.pendingImageBlob);
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    }

    return product;
  }

  // Al abrir un alta o una edición no debe verse el error de un guardado anterior.
  function handleCreateOpenChange(open: boolean) {
    if (open) {
      createProduct.reset();
    }
  }

  function openProductEdit(productId: string) {
    updateProduct.reset();
    updateProductPrice.reset();
    setProductToEditId(productId);
  }

  async function handleUpdateProduct(input: ProductInput) {
    if (!productToEditId || !editProduct) {
      return;
    }

    const { salePriceRef, ...productInput } = input;
    await updateProduct.mutateAsync(productInput);

    if (salePriceRef !== editProduct.salePriceRef) {
      await updateProductPrice.mutateAsync({ reason: PRODUCT_EDIT_PRICE_REASON, salePriceRef });
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
                onOpenChange={handleCreateOpenChange}
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
          filters={list.state}
          onChange={list.setState}
        />

        <div className="flex w-full flex-col md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-surface-container-lowest md:shadow-sm dark:md:border-slate-800">
          <DataTable
            actions={(product) => {
              const items: ActionMenuItem[] = [
                { href: detailHref(product.id), label: "Ver detalle" },
              ];

              if (!normalizeBarcode(product.barcode) && can("products.view")) {
                items.push({
                  label: "Agregar código de barras",
                  onSelect: () => setProductToAddBarcode(product),
                });
              }

              if (can("products.manage")) {
                items.push({
                  label: "Editar",
                  onSelect: () => openProductEdit(product.id),
                });
              }

              items.push({
                href: detailHref(product.id),
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
              <ProductDetailLink href={detailHref(product.id)} product={product} />
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
                      onOpenChange={handleCreateOpenChange}
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

          <div className="mt-3 rounded-xl border border-border bg-surface-container-lowest px-4 py-3 shadow-sm dark:border-slate-800 md:mt-0 md:rounded-none md:border-0 md:border-t md:bg-surface md:shadow-none dark:md:border-slate-800 sm:px-6">
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
      <AddProductBarcodeModal
        onOpenChange={(open) => {
          if (!open) {
            setProductToAddBarcode(null);
          }
        }}
        open={productToAddBarcode != null}
        product={productToAddBarcode}
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

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const ProductsListPage = withUrlListBoundary(ProductsList);
