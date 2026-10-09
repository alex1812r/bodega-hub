"use client";

import { Pencil } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { getPaginatedItems, MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { ProductKardexCard } from "@/modules/inventory/components/ProductKardexCard";
import { withChainedReturnTo } from "@/modules/inventory/utils/chainedReturnTo";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import { Can } from "@/shared/auth/Can";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { type TabItem, Tabs } from "@/shared/components/Tabs";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import { withUrlListBoundary } from "@/shared/hooks/useUrlListState";

import { KeepPriceConfirmModal } from "../components/price-review/KeepPriceConfirmModal";
import { PriceReviewBadge } from "../components/price-review/PriceReviewBadge";
import {
  getPriceReviewTargetPct,
  PriceReviewDetailNotice,
} from "../components/price-review/PriceReviewDetailNotice";
import {
  type ProductInput,
  useAllCategories,
  useProduct,
  useProductSuppliers,
  useUpdateProduct,
  useUpdateProductPrice,
} from "../hooks/useProducts";
import { getProductMarginThresholds } from "../services/productMargin";
import { PRODUCT_EDIT_PRICE_REASON } from "../services/productSchemas";
import { ProductDetailImageCard } from "./components/ProductDetailImageCard";
import { ProductDetailInfoCard } from "./components/ProductDetailInfoCard";
import { ProductDetailPackConversionCard } from "./components/ProductDetailPackConversionCard";
import { ProductDetailPageHeader } from "./components/ProductDetailPageHeader";
import { ProductDetailPriceChangeCard } from "./components/ProductDetailPriceChangeCard";
import { ProductDetailPriceHistoryCard } from "./components/ProductDetailPriceHistoryCard";
import { ProductDetailSalesHistoryCard } from "./components/ProductDetailSalesHistoryCard";
import { ProductDetailStockCard } from "./components/ProductDetailStockCard";
import {
  ProductDetailSuppliersTable,
  type ProductSupplierRow,
} from "./components/ProductDetailSuppliersTable";
import { ProductFormModal } from "./components/ProductFormModal";
import { PRODUCT_DETAIL_TAB_PARAM, type ProductDetailTab } from "./hooks/productDetailParams";
import { useProductDetailUrl } from "./hooks/useProductDetailUrl";

/** Recuerda si el kardex del Resumen quedó abierto o cerrado. */
const KARDEX_SECTION_STORAGE_KEY = "product-detail:kardex-open";

type ProductDetailsPageProps = {
  productId?: string;
};

function ProductDetails({ productId = "prod-drill" }: ProductDetailsPageProps) {
  const { can, role } = usePermission();
  const canSeeSuppliers = role ? canViewSupplierContacts(role) : false;
  // URL del detalle con su pestaña y su `returnTo`: a ella vuelven los enlaces que salen de aquí.
  const detailUrl = useProductDetailUrl();
  const product = useProduct(productId);
  const categories = useAllCategories();
  // Semáforo y chips de la tienda; sin datos (cargando o error) valen los por defecto.
  const pricingSettings = usePricingSettings();
  // Tasa vigente: solo para mostrar en Bs el cambio de precio antes de confirmarlo.
  const currentRate = useCurrentExchangeRate();
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
  // Al volver de un enlace del detalle, el scroll queda donde estaba. Se restaura una
  // vez, con la pestaña de la URL ya pintada: Proveedores e Historial cargan sus listas.
  const requestedTab = useSearchParams().get(PRODUCT_DETAIL_TAB_PARAM);
  const [isPriceHistoryReady, setIsPriceHistoryReady] = useState(false);
  const [isSalesHistoryReady, setIsSalesHistoryReady] = useState(false);
  const markPriceHistoryReady = useCallback(() => setIsPriceHistoryReady(true), []);
  const markSalesHistoryReady = useCallback(() => setIsSalesHistoryReady(true), []);
  const isActiveTabReady =
    requestedTab === "historial"
      ? isPriceHistoryReady && isSalesHistoryReady
      : requestedTab !== "proveedores" || !suppliers.isLoading;

  useScrollRestoration(detailUrl, { ready: Boolean(product.data) && isActiveTabReady });

  async function handleUpdateProduct(input: ProductInput) {
    const currentPrice = product.data?.salePriceRef;
    const { salePriceRef, ...productInput } = input;

    await updateProduct.mutateAsync(productInput);

    if (currentPrice !== undefined && salePriceRef !== currentPrice) {
      await updateProductPrice.mutateAsync({ reason: PRODUCT_EDIT_PRICE_REASON, salePriceRef });
    }
  }

  // La tarjeta espera el resultado: su confirmación se cierra con el éxito y, si
  // falla, muestra el motivo y sigue abierta (el fallo queda además en
  // `quickPriceUpdate.error`, que se pinta en el Resumen). `expectedCostRef` es el
  // costo que mostraba la tarjeta: si ya es otro, el servidor responde 409 y los
  // datos se refrescan.
  async function handleQuickPriceUpdate(
    salePriceRef: number,
    reason: string,
    expectedCostRef: number,
  ) {
    await quickPriceUpdate.mutateAsync({ expectedCostRef, reason, salePriceRef });
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
  // Conserva el `returnTo` con el que se llegó al detalle: al volver del kardex sigue ahí.
  // Solo con `inventory.view`: sin él, `/inventory/movements` responde 403.
  const movementsHref = can("inventory.view")
    ? withChainedReturnTo(
        `/inventory/movements?productId=${encodeURIComponent(data.id)}`,
        detailUrl,
      )
    : undefined;

  // "Reprecio" no cambia nada: lleva a la tarjeta de precio, con el foco en el % sugerido.
  function focusPriceCard() {
    const card = priceCardRef.current;

    card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    card?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }

  // Resumen: información, stock y precio a la vista (3 bloques); el kardex, plegado.
  const summaryTab = (
    <div className="space-y-6">
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
            isActive={data.isActive}
            salePriceRef={data.salePriceRef}
            thresholds={marginThresholds}
            underReview={Boolean(data.priceReview)}
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-4 lg:row-span-2">
          <ProductDetailStockCard
            adjustableProduct={{ id: data.id, name: data.name, sku: data.sku }}
            currentStock={data.currentStock}
            minStock={data.minStock}
            movementsHref={movementsHref}
          />
          <div className="empty:hidden" ref={priceCardRef}>
            <Can permission="products.manage">
              <ProductDetailPriceChangeCard
                categoryMarkupPct={reviewTargetPct ?? data.category?.defaultMarkupPct}
                currentCostRef={data.currentCostRef}
                currentPriceRef={data.salePriceRef}
                isSubmitting={quickPriceUpdate.isPending}
                onSubmit={handleQuickPriceUpdate}
                pricing={pricingSettings.data}
                productName={data.name}
                rateVes={currentRate.data?.rateVes}
              />
            </Can>
          </div>
        </div>
        {can("inventory.view") ? (
          <div className="lg:col-span-8">
            <CollapsibleSection
              storageKey={KARDEX_SECTION_STORAGE_KEY}
              summary="Saldo de 30 días, entradas, salidas y últimos movimientos"
              title="Kardex del producto"
            >
              <ProductKardexCard productId={data.id} returnTo={detailUrl} />
            </CollapsibleSection>
          </div>
        ) : null}
      </div>
    </div>
  );

  const tabs: TabItem<ProductDetailTab>[] = [
    { content: summaryTab, label: "Resumen", value: "resumen" },
    ...(canSeeSuppliers
      ? [
          {
            content: (
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
            ),
            label: "Proveedores",
            value: "proveedores" as const,
          },
        ]
      : []),
    {
      content: (
        <div className="space-y-6">
          <ProductDetailPriceHistoryCard onReady={markPriceHistoryReady} productId={productId} />
          <ProductDetailSalesHistoryCard onReady={markSalesHistoryReady} productId={productId} />
        </div>
      ),
      label: "Historial",
      value: "historial",
    },
    {
      content: (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {data.packConversion ? (
            <ProductDetailPackConversionCard
              packConversion={data.packConversion}
              productId={data.id}
              productName={data.name}
              productStock={data.currentStock}
              onConverted={() => void product.refetch()}
            />
          ) : (
            <p className="rounded-xl border border-border bg-surface-container-lowest p-5 text-sm text-on-surface-variant dark:border-slate-800">
              Este producto no tiene conversión de empaque.
            </p>
          )}
          <ProductDetailImageCard canManage={can("products.manage")} imageUrl={data.imageUrl} />
        </div>
      ),
      label: "Avanzado",
      value: "avanzado",
    },
  ];

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

      <Tabs
        ariaLabel="Secciones del producto"
        defaultValue="resumen"
        items={tabs}
        urlParam={PRODUCT_DETAIL_TAB_PARAM}
      />

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

export const ProductDetailsPage = withUrlListBoundary(ProductDetails);
