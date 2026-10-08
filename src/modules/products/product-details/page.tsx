"use client";

import { Pencil } from "lucide-react";

import { getPriceChangeReason } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import { Can } from "@/shared/auth/Can";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatDate } from "@/shared/utils/date";

import {
  type ProductInput,
  type ProductPriceHistoryEntry,
  useCategories,
  useProduct,
  useProductPriceHistory,
  useProductSuppliers,
  useUpdateProduct,
  useUpdateProductPrice,
} from "../hooks/useProducts";
import { getProductMarginThresholds } from "../services/productMargin";
import { PRODUCT_EDIT_PRICE_REASON } from "../services/productSchemas";
import type { ProductFormSubmitContext } from "./components/ProductFormModal";
import { ProductDetailPackConversionCard } from "./components/ProductDetailPackConversionCard";
import { ProductDetailInfoCard } from "./components/ProductDetailInfoCard";
import { ProductDetailPageHeader } from "./components/ProductDetailPageHeader";
import { ProductDetailPriceChangeCard } from "./components/ProductDetailPriceChangeCard";
import {
  ProductDetailPriceHistoryTable,
  type ProductPriceHistoryRow,
} from "./components/ProductDetailPriceHistoryTable";
import { ProductDetailSalesHistoryCard } from "./components/ProductDetailSalesHistoryCard";
import { ProductDetailStockCard } from "./components/ProductDetailStockCard";
import {
  ProductDetailSuppliersTable,
  type ProductSupplierRow,
} from "./components/ProductDetailSuppliersTable";
import { ProductFormModal } from "./components/ProductFormModal";

type ProductDetailsPageProps = {
  productId?: string;
};

function mapPriceHistory(rows: ProductPriceHistoryEntry[]): ProductPriceHistoryRow[] {
  return rows.map((row, index) => ({
    changedBy: row.userId,
    date: formatDate(row.createdAt),
    id: row.id,
    newPriceRef: row.salePriceRef,
    oldPriceRef: rows[index + 1]?.salePriceRef ?? row.salePriceRef,
    // El motivo guardado; el texto fijo solo si el cambio se registró sin motivo.
    reason: row.reason?.trim() || getPriceChangeReason(),
  }));
}

export function ProductDetailsPage({ productId = "prod-drill" }: ProductDetailsPageProps) {
  const { can, role } = usePermission();
  const canSeeSuppliers = role ? canViewSupplierContacts(role) : false;
  const product = useProduct(productId);
  const categories = useCategories();
  // Semáforo y chips de la tienda; sin datos (cargando o error) valen los por defecto.
  const pricingSettings = usePricingSettings();
  const priceHistory = useProductPriceHistory(productId);
  const suppliers = useProductSuppliers(canSeeSuppliers ? productId : undefined);
  const updateProduct = useUpdateProduct(productId);
  const updateProductPrice = useUpdateProductPrice(productId);
  // Mutación aparte para la tarjeta de cambio rápido: su error se avisa en la
  // página (la tarjeta no lo pinta) y el de la edición solo dentro del modal.
  const quickPriceUpdate = useUpdateProductPrice(productId);

  async function handleUpdateProduct(input: ProductInput, context?: ProductFormSubmitContext) {
    const currentPrice = product.data?.salePriceRef;
    const { salePriceRef, ...productInput } = input;

    await updateProduct.mutateAsync(productInput);

    if (currentPrice !== undefined && salePriceRef !== currentPrice) {
      await updateProductPrice.mutateAsync({ reason: PRODUCT_EDIT_PRICE_REASON, salePriceRef });
    }
  }

  // `mutate`, no `mutateAsync`: la tarjeta no espera el resultado y un fallo
  // se queda en `quickPriceUpdate.error` (se pinta abajo) en vez de subir como
  // promesa rechazada sin manejar.
  function handleQuickPriceUpdate(salePriceRef: number, reason: string) {
    quickPriceUpdate.mutate({ reason, salePriceRef });
  }

  if (product.isLoading) {
    return <DetailSkeleton itemsPerSection={4} />;
  }

  if (product.error || !product.data) {
    return (
      <ErrorState
        description={
          product.error instanceof Error
            ? product.error.message
            : "No pudimos cargar el detalle del producto."
        }
        onRetry={() => void product.refetch()}
        title="No pudimos cargar el producto"
      />
    );
  }

  const data = product.data;
  const isSaving = updateProduct.isPending || updateProductPrice.isPending;
  const supplierRows = getPaginatedItems(suppliers.data) as ProductSupplierRow[];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <ProductDetailPageHeader
        actions={
          <Can permission="products.manage">
            <ProductFormModal
              categories={getPaginatedItems(categories.data)}
              errorMessage={updateProduct.error?.message ?? updateProductPrice.error?.message}
              isSubmitting={isSaving}
              mode="edit"
              onImageUpdated={() => void product.refetch()}
              onOpenChange={(open) => {
                // Al abrir no debe verse el error de un guardado anterior.
                if (open) {
                  updateProduct.reset();
                  updateProductPrice.reset();
                }
              }}
              onSubmit={handleUpdateProduct}
              product={data}
              trigger={
                <Button
                  className="w-full gap-2 sm:w-auto"
                  disabled={isSaving}
                  size="sm"
                  type="button"
                >
                  <Pencil aria-hidden className="size-[1.125rem]" />
                  {isSaving ? "Guardando..." : "Editar"}
                </Button>
              }
            />
          </Can>
        }
        productName={data.name}
        barcode={data.barcode}
        sku={data.sku}
      />

      {quickPriceUpdate.error ? (
        <ErrorState
          description={
            quickPriceUpdate.error instanceof Error
              ? quickPriceUpdate.error.message
              : "No se pudo guardar el cambio."
          }
          title="No pudimos actualizar el producto"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <ProductDetailInfoCard
            categoryName={data.category?.name ?? "Sin categoría"}
            costRef={data.currentCostRef}
            imageUrl={data.imageUrl}
            isActive={data.isActive}
            salePriceRef={data.salePriceRef}
            thresholds={getProductMarginThresholds(pricingSettings.data)}
          />
        </div>
        <div className="lg:col-span-4">
          <ProductDetailStockCard
            adjustableProduct={{ id: data.id, name: data.name, sku: data.sku }}
            currentStock={data.currentStock}
            minStock={data.minStock}
          />
        </div>
        {data.packConversion ? (
          <div className="lg:col-span-4">
            <ProductDetailPackConversionCard
              packConversion={data.packConversion}
              productId={data.id}
              productName={data.name}
              productStock={data.currentStock}
              onConverted={() => void product.refetch()}
            />
          </div>
        ) : null}
        <div className="lg:col-span-4">
          <Can permission="products.manage">
            <ProductDetailPriceChangeCard
              categoryMarkupPct={data.category?.defaultMarkupPct}
              currentCostRef={data.currentCostRef}
              currentPriceRef={data.salePriceRef}
              isSubmitting={quickPriceUpdate.isPending}
              onSubmit={handleQuickPriceUpdate}
              pricing={pricingSettings.data}
            />
          </Can>
        </div>
        <div className={can("products.manage") ? "lg:col-span-8" : "lg:col-span-12"}>
          <ProductDetailPriceHistoryTable
            rows={mapPriceHistory(getPaginatedItems(priceHistory.data))}
          />
        </div>
        {canSeeSuppliers ? (
          <div className="lg:col-span-12">
            <ProductDetailSuppliersTable
              error={suppliers.error}
              isLoading={suppliers.isLoading}
              onRetry={() => void suppliers.refetch()}
              productId={productId}
              productName={data.name}
              productSku={data.sku}
              rows={supplierRows}
              salePriceRef={data.salePriceRef}
            />
          </div>
        ) : null}
        <div className="lg:col-span-12">
          <ProductDetailSalesHistoryCard productId={productId} />
        </div>
      </div>
    </div>
  );
}
