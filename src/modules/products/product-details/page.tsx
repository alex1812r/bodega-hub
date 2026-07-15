"use client";

import { Pencil } from "lucide-react";

import { getPriceChangeReason } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatDate } from "@/shared/utils/date";

import {
  type ProductInput,
  useCategories,
  useProduct,
  useProductPriceHistory,
  useProductSuppliers,
  useUpdateProduct,
  useUpdateProductPrice,
} from "../hooks/useProducts";
import type { ProductFormSubmitContext } from "./components/ProductFormModal";
import { ProductDetailInfoCard } from "./components/ProductDetailInfoCard";
import { ProductDetailPageHeader } from "./components/ProductDetailPageHeader";
import { ProductDetailPriceChangeCard } from "./components/ProductDetailPriceChangeCard";
import {
  ProductDetailPriceHistoryTable,
  type ProductPriceHistoryRow,
} from "./components/ProductDetailPriceHistoryTable";
import { ProductDetailStockCard } from "./components/ProductDetailStockCard";
import {
  ProductDetailSuppliersTable,
  type ProductSupplierRow,
} from "./components/ProductDetailSuppliersTable";
import { ProductFormModal } from "./components/ProductFormModal";

type ProductDetailsPageProps = {
  productId?: string;
};

function mapPriceHistory(
  rows: { createdAt: string; id: string; salePriceRef: number; userId: string }[],
): ProductPriceHistoryRow[] {
  return rows.map((row, index) => ({
    changedBy: row.userId,
    date: formatDate(row.createdAt),
    id: row.id,
    newPriceRef: row.salePriceRef,
    oldPriceRef: rows[index + 1]?.salePriceRef ?? row.salePriceRef,
    reason: getPriceChangeReason(),
  }));
}

export function ProductDetailsPage({ productId = "prod-drill" }: ProductDetailsPageProps) {
  const { can } = usePermission();
  const product = useProduct(productId);
  const categories = useCategories();
  const priceHistory = useProductPriceHistory(productId);
  const suppliers = useProductSuppliers(productId);
  const updateProduct = useUpdateProduct(productId);
  const updateProductPrice = useUpdateProductPrice(productId);

  async function handleUpdateProduct(input: ProductInput, context?: ProductFormSubmitContext) {
    const currentPrice = product.data?.salePriceRef;
    const { salePriceRef, ...productInput } = input;

    await updateProduct.mutateAsync(productInput);

    if (currentPrice !== undefined && salePriceRef !== currentPrice) {
      await updateProductPrice.mutateAsync({ salePriceRef });
    }
  }

  async function handleQuickPriceUpdate(salePriceRef: number) {
    await updateProductPrice.mutateAsync({ salePriceRef });
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

      {updateProduct.error || updateProductPrice.error ? (
        <ErrorState
          description={
            (updateProduct.error ?? updateProductPrice.error) instanceof Error
              ? (updateProduct.error ?? updateProductPrice.error)?.message
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
          />
        </div>
        <div className="lg:col-span-4">
          <ProductDetailStockCard
            currentStock={data.currentStock}
            minStock={data.minStock}
          />
        </div>
        <div className="lg:col-span-4">
          <Can permission="products.manage">
            <ProductDetailPriceChangeCard
              currentPriceRef={data.salePriceRef}
              isSubmitting={updateProductPrice.isPending}
              onSubmit={handleQuickPriceUpdate}
            />
          </Can>
        </div>
        <div className={can("products.manage") ? "lg:col-span-8" : "lg:col-span-12"}>
          <ProductDetailPriceHistoryTable
            rows={mapPriceHistory(getPaginatedItems(priceHistory.data))}
          />
        </div>
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
      </div>
    </div>
  );
}
