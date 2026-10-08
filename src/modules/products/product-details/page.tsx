"use client";

import { Pencil } from "lucide-react";
import { useRef, useState } from "react";

import { getPriceChangeReason } from "@/lib/api/dataSourceUi";
import { getPaginatedItems, MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import { Can } from "@/shared/auth/Can";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatDate } from "@/shared/utils/date";

import { KeepPriceConfirmModal } from "../components/price-review/KeepPriceConfirmModal";
import { PriceReviewBadge } from "../components/price-review/PriceReviewBadge";
import {
  getPriceReviewTargetPct,
  PriceReviewDetailNotice,
} from "../components/price-review/PriceReviewDetailNotice";
import {
  type ProductInput,
  type ProductPriceHistoryEntry,
  useAllCategories,
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
    // Nunca el id: sin nombre (línea base, o un perfil que no puedes ver) queda "—".
    changedBy: row.userName?.trim() || "—",
    date: formatDate(row.createdAt),
    id: row.id,
    // Entradas anteriores a PRO-11 no traen `kind`: eran todas cambios de precio.
    kind: row.kind ?? "change",
    newPriceRef: row.salePriceRef,
    // El precio anterior es el que guardó la propia fila. Solo si no lo trae se
    // deduce de la fila vecina; la más antigua sin dato queda sin precio anterior
    // (antes repetía el suyo: "14.00 → 14.00").
    oldPriceRef: row.previousSalePriceRef ?? rows[index + 1]?.salePriceRef ?? null,
    // El motivo guardado; el texto fijo solo si el cambio se registró sin motivo.
    reason: row.reason?.trim() || getPriceChangeReason(),
  }));
}

export function ProductDetailsPage({ productId = "prod-drill" }: ProductDetailsPageProps) {
  const { can, role } = usePermission();
  const canSeeSuppliers = role ? canViewSupplierContacts(role) : false;
  const product = useProduct(productId);
  const categories = useAllCategories();
  // Semáforo y chips de la tienda; sin datos (cargando o error) valen los por defecto.
  const pricingSettings = usePricingSettings();
  const priceHistory = useProductPriceHistory(productId);
  // La tabla no pagina: sin `limit` el BFF entrega 10 y un producto admite 50 proveedores.
  const suppliers = useProductSuppliers(canSeeSuppliers ? productId : undefined, {
    limit: MAX_PAGE_LIMIT,
  });
  const updateProduct = useUpdateProduct(productId);
  const updateProductPrice = useUpdateProductPrice(productId);
  // Mutación aparte para la tarjeta de cambio rápido: su error se avisa en la
  // página (la tarjeta no lo pinta) y el de la edición solo dentro del modal.
  const quickPriceUpdate = useUpdateProductPrice(productId);
  const priceCardRef = useRef<HTMLDivElement | null>(null);
  const [isKeepPriceOpen, setIsKeepPriceOpen] = useState(false);

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
  // promesa rechazada sin manejar. `expectedCostRef` es el costo que mostraba
  // la tarjeta: si ya es otro, el servidor responde 409 y los datos se refrescan.
  function handleQuickPriceUpdate(salePriceRef: number, reason: string, expectedCostRef: number) {
    quickPriceUpdate.mutate({ expectedCostRef, reason, salePriceRef });
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
  const marginThresholds = getProductMarginThresholds(pricingSettings.data);
  // En "Por revisar", el % sugerido de la tarjeta es el que devuelve el precio a la banda que tenía.
  const reviewTargetPct = data.priceReview
    ? getPriceReviewTargetPct(data.priceReview.previousBand, marginThresholds)
    : null;

  // "Reprecio" no cambia nada: lleva a la tarjeta de precio, con el foco en el % sugerido.
  function focusPriceCard() {
    const card = priceCardRef.current;

    card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    card?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }

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
        badge={data.priceReview ? <PriceReviewBadge review={data.priceReview} /> : null}
        productName={data.name}
        barcode={data.barcode}
        sku={data.sku}
      />

      {data.priceReview ? (
        <PriceReviewDetailNotice
          canManage={can("products.manage")}
          onKeepPrice={() => setIsKeepPriceOpen(true)}
          onReprice={focusPriceCard}
          review={data.priceReview}
          thresholds={marginThresholds}
        />
      ) : null}

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
            description={data.description}
            imageUrl={data.imageUrl}
            isActive={data.isActive}
            salePriceRef={data.salePriceRef}
            thresholds={marginThresholds}
            underReview={Boolean(data.priceReview)}
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
        <div className="lg:col-span-4" ref={priceCardRef}>
          <Can permission="products.manage">
            <ProductDetailPriceChangeCard
              categoryMarkupPct={reviewTargetPct ?? data.category?.defaultMarkupPct}
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

      <Can permission="products.manage">
        <KeepPriceConfirmModal
          onOpenChange={setIsKeepPriceOpen}
          open={isKeepPriceOpen}
          product={data}
        />
      </Can>
    </div>
  );
}
