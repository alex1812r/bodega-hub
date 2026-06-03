"use client";

import {
  getConnectedToApiPhrase,
  getPriceChangeReason,
  isMockDataSource,
} from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSection } from "@/shared/components/DetailSection";
import { PageHeader } from "@/shared/components/PageHeader";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import type { SupplierProductMock } from "@/shared/mocks/erp-data";
import { formatRef } from "@/shared/utils/currency";
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
import { ProductFormModal } from "./components/ProductFormModal";
import { ProductPriceHistoryTable } from "./components/ProductPriceHistoryTable";
import { ProductStockSummary } from "./components/ProductStockSummary";
import { ProductSummaryCard } from "./components/ProductSummaryCard";

type ProductDetailsPageProps = {
  productId?: string;
};

type ProductSupplierRow = SupplierProductMock & {
  supplier?: {
    name: string;
  };
};

const supplierColumns: DataTableColumn<ProductSupplierRow>[] = [
  {
    header: "Proveedor",
    key: "supplier",
    render: (row) => row.supplier?.name ?? row.supplierId,
  },
  {
    header: "SKU proveedor",
    key: "supplierSku",
    render: (row) => row.supplierSku ?? "Sin SKU",
  },
  {
    align: "right",
    header: "Ultimo costo",
    key: "lastCostRef",
    render: (row) => formatRef(row.lastCostRef),
  },
];

function mapPriceHistory(
  rows: { createdAt: string; id: string; salePriceRef: number; userId: string }[],
) {
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
  const product = useProduct(productId);
  const categories = useCategories();
  const priceHistory = useProductPriceHistory(productId);
  const suppliers = useProductSuppliers(productId);
  const updateProduct = useUpdateProduct(productId);
  const updateProductPrice = useUpdateProductPrice(productId);

  async function handleUpdateProduct(input: ProductInput) {
    const currentPrice = product.data?.salePriceRef;
    const { salePriceRef, ...productInput } = input;

    await updateProduct.mutateAsync(productInput);

    if (currentPrice !== undefined && salePriceRef !== currentPrice) {
      await updateProductPrice.mutateAsync({ salePriceRef });
    }
  }

  if (product.isLoading) {
    return (
      <LoadingState
        description="Estamos consultando producto, precios y proveedores."
        title="Cargando producto"
      />
    );
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

  const summary = {
    category: product.data.category?.name ?? "Sin categoria",
    costRef: product.data.currentCostRef,
    name: product.data.name,
    priceRef: product.data.salePriceRef,
    sku: product.data.sku,
    status: product.data.isActive ? "activo" as const : "inactivo" as const,
  };
  const stock = {
    lastMovement: "Consulta movimientos en Inventario",
    minimumStock: product.data.minStock,
    stock: product.data.currentStock,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <ProductFormModal
            categories={getPaginatedItems(categories.data)}
            errorMessage={updateProduct.error?.message ?? updateProductPrice.error?.message}
            isSubmitting={updateProduct.isPending || updateProductPrice.isPending}
            mode="edit"
            onSubmit={handleUpdateProduct}
            product={product.data}
          />
        }
        badge={<p className="text-sm font-medium text-blue-600">Producto</p>}
        description={`Vista del producto ${getConnectedToApiPhrase()}.`}
        title={product.data.name}
      />

      <ProductSummaryCard product={summary} />
      <ProductStockSummary stock={stock} />
      <ProductPriceHistoryTable
        rows={mapPriceHistory(getPaginatedItems(priceHistory.data))}
      />
      <DetailSection
        description={
          isMockDataSource()
            ? "Relacion proveedor-producto conectada al endpoint mock."
            : "Relacion proveedor-producto desde Supabase."
        }
        title="Proveedores"
      >
        <DataTable
          columns={supplierColumns}
          data={getPaginatedItems(suppliers.data) as ProductSupplierRow[]}
          error={suppliers.error}
          getRowId={(row) => row.id}
          isFetching={suppliers.isFetching}
          isLoading={suppliers.isLoading}
          loadingRows={3}
          onRetry={() => void suppliers.refetch()}
        />
      </DetailSection>
    </div>
  );
}
