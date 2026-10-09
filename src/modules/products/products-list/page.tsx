"use client";

import { Plus, Tags, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getPaginatedItems } from "@/lib/api/pagination";
import { InventorySkuCell } from "@/modules/inventory/inventory-list/components/InventorySkuCell";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
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
import { useToast } from "@/shared/components/Toast";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { cn } from "@/shared/utils/cn";
import type { MarginThresholds } from "@/shared/utils/pricing";
import { withReturnTo } from "@/shared/utils/returnTo";

import {
  KeepPriceConfirmModal,
  type KeepPriceProduct,
} from "../components/price-review/KeepPriceConfirmModal";
import { PriceReviewBadge } from "../components/price-review/PriceReviewBadge";
import {
  PriceReviewBulkBar,
  priceReviewCheckboxClassName,
} from "../components/price-review/PriceReviewBulkBar";
import {
  describeRepriceUpdated,
  PriceReviewRepriceResult,
} from "../components/price-review/PriceReviewRepriceResult";
import { RepriceConfirmModal } from "../components/price-review/RepriceConfirmModal";
import { type RepriceResult, usePriceReviewSummary } from "../hooks/usePriceReview";
import { ProductFormModal } from "../product-details/components/ProductFormModal";
import type { ProductFormSubmitContext } from "../product-details/components/ProductFormModal";
import { uploadProductImageBlob } from "../services/uploadProductImage";
import {
  type ProductInput,
  type ProductWithCategory,
  productsQueryKeys,
  useAllCategories,
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
import { getProductMarginThresholds, getProductPricingOptions } from "../services/productMargin";
import { PRODUCT_EDIT_PRICE_REASON } from "../services/productSchemas";
import { normalizeBarcode } from "../services/productSearch";
import {
  productsListSchema,
  toInventoryListHref,
  toInventoryProductHref,
  toProductsFilters,
} from "./productsListParams";

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
/** Enlace de la celda "Stock": mismo trato que el del nombre, en línea para respetar la alineación. */
const stockLinkClass =
  "rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function isLowStock(product: ProductWithCategory) {
  return product.isActive && product.currentStock > 0 && product.currentStock <= product.minStock;
}

/** Casilla por fila de la acción masiva; solo existe con el filtro "Por revisar" y `products.manage`. */
type RowSelection = {
  isSelected: (productId: string) => boolean;
  onToggle: (productId: string, selected: boolean) => void;
};

/**
 * Nombre de la fila (tabla y tarjeta móvil): enlace al detalle y, debajo, el
 * aviso "Por revisar". El aviso y la casilla van fuera del enlace y dentro de
 * esta celda, que ya es la flexible: no añaden ancho a la tabla (PRO-F2).
 */
function ProductNameCell({
  href,
  product,
  selection,
}: {
  href: string;
  product: ProductWithCategory;
  selection?: RowSelection;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {selection ? (
        <input
          aria-label={`Seleccionar ${product.name}`}
          checked={selection.isSelected(product.id)}
          className={cn(priceReviewCheckboxClassName, "mt-2.5")}
          onChange={(event) => selection.onToggle(product.id, event.target.checked)}
          type="checkbox"
        />
      ) : null}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Link className={detailLinkClass} href={href}>
          <ProductNameWithThumb
            imageUrl={product.imageUrl}
            isActive={product.isActive}
            name={product.name}
          />
        </Link>
        {product.priceReview ? <PriceReviewBadge review={product.priceReview} /> : null}
      </div>
    </div>
  );
}

function buildProductColumns(
  rateVes: number,
  detailHref: (productId: string) => string,
  thresholds: MarginThresholds,
  selection?: RowSelection,
  /** Fila del producto en `/inventory` (INV-06); solo llega con `inventory.view`. */
  stockHref?: (productId: string) => string,
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
      render: (product) => (
        <ProductNameCell href={detailHref(product.id)} product={product} selection={selection} />
      ),
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
            thresholds={thresholds}
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
          <MarginBadge
            cost={product.currentCostRef}
            price={product.salePriceRef}
            thresholds={thresholds}
          />
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
      render: (product) => {
        const stockClassName = cn(
          !product.isActive && "text-outline",
          product.currentStock === 0 && product.isActive && "font-medium text-destructive",
          isLowStock(product) && "font-medium text-destructive",
        );

        return stockHref ? (
          <Link
            aria-label={`Ver el stock de ${product.name} en Inventario: ${product.currentStock} un`}
            className={cn(stockLinkClass, stockClassName)}
            href={stockHref(product.id)}
          >
            {product.currentStock} un
          </Link>
        ) : (
          <span className={stockClassName}>{product.currentStock} un</span>
        );
      },
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
  const [productToKeepPrice, setProductToKeepPrice] = useState<KeepPriceProduct | null>(null);
  // La selección es local (no va a la URL) y pertenece a una URL exacta de la
  // lista: al cambiar de página, filtro u orden deja de valer.
  const [selection, setSelection] = useState<{ ids: string[]; scope: string }>({
    ids: [],
    scope: "",
  });
  const [repricePct, setRepricePct] = useState<number | null>(null);
  const [repriceOutcome, setRepriceOutcome] = useState<{
    names: Record<string, string>;
    result: RepriceResult;
  } | null>(null);
  const { showToast } = useToast();
  const { handleSort, sortBy, sortOrder } = useUrlSortState(list);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const products = useProducts({
    ...toProductsFilters(list.state, debouncedSearch),
    limit,
    skip,
  });
  const categories = useAllCategories();
  const currentRate = useCurrentExchangeRate();
  const rateVes = currentRate.data?.rateVes ?? 0;
  // El detalle vuelve a esta URL exacta (filtros, orden y página) con "Volver".
  const listHref = list.href;
  const detailHref = useCallback(
    (productId: string) => withReturnTo(`/products/${productId}`, listHref),
    [listHref],
  );
  // El stock se consulta en Inventario (INV-06): quien no lo ve se queda con el número.
  const canViewInventory = can("inventory.view");
  const stockHref = useMemo(
    () =>
      canViewInventory
        ? (productId: string) => toInventoryProductHref(productId, listHref)
        : undefined,
    [canViewInventory, listHref],
  );
  // Semáforo de la tienda; sin datos (cargando o error) valen los cortes por defecto.
  const pricingSettings = usePricingSettings();
  const marginThresholds = useMemo(
    () => getProductMarginThresholds(pricingSettings.data),
    [pricingSettings.data],
  );
  const priceReviewSummary = usePriceReviewSummary();
  const isReviewFilterOn = list.state.review === "1";
  // La acción masiva solo existe en "Por revisar": la lista normal no carga casillas.
  const canBulkReprice = isReviewFilterOn && can("products.manage");
  const selectedIds = useMemo(
    () => (selection.scope === listHref ? selection.ids : []),
    [listHref, selection],
  );
  const rowSelection = useMemo<RowSelection | undefined>(
    () =>
      canBulkReprice
        ? {
            isSelected: (productId) => selectedIds.includes(productId),
            onToggle: (productId, selected) =>
              setSelection({
                ids: selected
                  ? [...selectedIds.filter((id) => id !== productId), productId]
                  : selectedIds.filter((id) => id !== productId),
                scope: listHref,
              }),
          }
        : undefined,
    [canBulkReprice, listHref, selectedIds],
  );
  const columns = useMemo(
    () => buildProductColumns(rateVes, detailHref, marginThresholds, rowSelection, stockHref),
    [detailHref, marginThresholds, rateVes, rowSelection, stockHref],
  );
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
  // Solo cuentan los seleccionados que siguen en la página (un reprecio saca filas de la cola).
  const selectedProducts = productItems.filter((product) => selectedIds.includes(product.id));

  function handleRepriceDone(result: RepriceResult) {
    const failedIds = result.results
      .filter((row) => row.status === "error")
      .map((row) => row.productId);

    setRepriceOutcome({
      names: Object.fromEntries(selectedProducts.map((product) => [product.id, product.name])),
      result,
    });
    // Los que fallaron quedan seleccionados para corregirlos o reintentar.
    setSelection({ ids: failedIds, scope: listHref });
    showToast({
      description:
        result.failed === 0
          ? undefined
          : result.failed === 1
            ? "1 producto no se pudo cambiar. Revisa el detalle en la lista."
            : `${result.failed} productos no se pudieron cambiar. Revisa el detalle en la lista.`,
      title: describeRepriceUpdated(result.updated),
      tone: result.failed === 0 ? "success" : result.updated === 0 ? "error" : "info",
    });
  }

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
    // No se cierra aquí: el formulario guarda después los proveedores (PRO-14) y
    // se cierra él mismo con `onOpenChange(false)`.
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
                suppliersOnCreate
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
          inventoryHref={canViewInventory ? toInventoryListHref(list.state, listHref) : undefined}
          onChange={list.setState}
          reviewCount={priceReviewSummary.data?.total}
        />

        {canBulkReprice ? (
          <PriceReviewBulkBar
            chips={getProductPricingOptions(pricingSettings.data).chips}
            onReprice={setRepricePct}
            onTogglePage={(selected) =>
              setSelection({
                ids: selected ? productItems.map((product) => product.id) : [],
                scope: listHref,
              })
            }
            pageCount={productItems.length}
            selectedCount={selectedProducts.length}
          />
        ) : null}

        {isReviewFilterOn && repriceOutcome ? (
          <PriceReviewRepriceResult
            onDismiss={() => setRepriceOutcome(null)}
            productNames={repriceOutcome.names}
            result={repriceOutcome.result}
          />
        ) : null}

        {/* Un error con parámetros en la URL: "Reintentar" repite la misma petición; esto saca de ahí. */}
        {products.error && !list.isDefault ? (
          <div className="flex justify-end">
            <Button onClick={list.reset} size="sm" variant="outline">
              Restablecer filtros
            </Button>
          </div>
        ) : null}

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

              if (product.priceReview && can("products.manage")) {
                // "Cambiar precio" lleva a lo que ya existe: la tarjeta de precio del detalle.
                items.push(
                  { href: detailHref(product.id), label: "Cambiar precio" },
                  {
                    label: "Mantener precio",
                    onSelect: () => setProductToKeepPrice(product),
                  },
                );
              }

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
              <ProductNameCell
                href={detailHref(product.id)}
                product={product}
                selection={rowSelection}
              />
            )}
            columns={columns}
            data={productItems}
            embedded
            emptyState={
              isReviewFilterOn ? (
                <EmptyState
                  action={
                    <Button onClick={() => list.setState({ review: "" })} size="sm" variant="outline">
                      Ver todos los productos
                    </Button>
                  }
                  description="Cuando el costo de un producto suba y su ganancia baje de banda, aparecerá aquí."
                  title="Ningún producto bajó de ganancia"
                />
              ) : (
                <EmptyState
                  action={
                    <Can permission="products.manage">
                      <ProductFormModal
                        categories={getPaginatedItems(categories.data)}
                        errorMessage={createProduct.error?.message}
                        isSubmitting={createProduct.isPending}
                        onOpenChange={handleCreateOpenChange}
                        onSubmit={handleCreateProduct}
                        suppliersOnCreate
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
              )
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
      <KeepPriceConfirmModal
        onOpenChange={(open) => {
          if (!open) {
            setProductToKeepPrice(null);
          }
        }}
        open={productToKeepPrice != null}
        product={productToKeepPrice}
      />
      {repricePct !== null ? (
        <RepriceConfirmModal
          markupPct={repricePct}
          onDone={handleRepriceDone}
          onOpenChange={(open) => {
            if (!open) {
              setRepricePct(null);
            }
          }}
          open
          products={selectedProducts}
        />
      ) : null}
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
