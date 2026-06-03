"use client";

import Link from "next/link";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSection } from "@/shared/components/DetailSection";
import { ErrorState } from "@/shared/components/ErrorState";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { PageHeader } from "@/shared/components/PageHeader";
import { LoadingState } from "@/shared/components/LoadingState";
import type { PaymentMock, PurchaseItemMock, PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import {
  type PurchaseDetails,
  useCancelPurchase,
  usePurchase,
  useReceivePurchase,
  useReturnPurchase,
} from "../hooks/usePurchases";
import { Can } from "@/shared/auth/Can";

const statusVariant = {
  cancelado: "danger",
  devuelto: "warning",
  pedido: "info",
  recibido: "success",
} as const;

type PurchaseDetailsPageProps = {
  purchaseId?: string;
};

type PurchaseItemRow = PurchaseItemMock & {
  product?: {
    name: string;
    sku: string;
  };
};

const itemColumns: DataTableColumn<PurchaseItemRow>[] = [
  {
    header: "Producto",
    key: "product",
    render: (item) => item.product?.name ?? item.productId,
  },
  { header: "SKU", key: "sku", render: (item) => item.product?.sku ?? "Sin SKU" },
  { align: "right", header: "Cantidad", key: "quantity", render: (item) => item.quantity },
  {
    align: "right",
    header: "Costo ref",
    key: "unitCostRef",
    render: (item) => formatRef(item.unitCostRef),
  },
  {
    align: "right",
    header: "Subtotal ref",
    key: "subtotalRef",
    render: (item) => formatRef(item.subtotalRef),
  },
  {
    align: "right",
    header: "Subtotal VES",
    key: "subtotalVes",
    render: (item) => formatVes(item.subtotalVes),
  },
];

const paymentColumns: DataTableColumn<PaymentMock>[] = [
  { header: "Fecha", key: "createdAt", render: (payment) => formatDate(payment.createdAt) },
  { header: "Metodo", key: "method", render: (payment) => payment.method },
  {
    align: "right",
    header: "Monto VES",
    key: "amountVes",
    render: (payment) => formatVes(payment.amountVes),
  },
  {
    header: "Referencia",
    key: "referenceCode",
    render: (payment) => payment.referenceCode ?? "Sin referencia",
  },
];

function canMutatePurchase(status: PurchaseStatus) {
  return status !== "cancelado" && status !== "devuelto";
}

function purchaseBalanceVes(purchase: PurchaseDetails) {
  return Math.max(purchase.totalVes - purchase.paidVes, 0);
}

export function PurchaseDetailsPage({
  purchaseId = "purchase-001",
}: PurchaseDetailsPageProps) {
  const purchase = usePurchase(purchaseId);
  const cancelPurchase = useCancelPurchase(purchaseId);
  const receivePurchase = useReceivePurchase(purchaseId);
  const returnPurchase = useReturnPurchase(purchaseId);

  if (purchase.isLoading) {
    return (
      <LoadingState
        description="Estamos consultando proveedor, productos y pagos de la compra."
        title="Cargando compra"
      />
    );
  }

  if (purchase.error || !purchase.data) {
    return (
      <ErrorState
        description={
          purchase.error instanceof Error
            ? purchase.error.message
            : "No pudimos cargar el detalle de la compra."
        }
        onRetry={() => void purchase.refetch()}
        title="No pudimos cargar la compra"
      />
    );
  }

  const canMutate = canMutatePurchase(purchase.data.status);

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/purchases">Volver</Link>
          </Button>
          <Can permission="payments.manage">
            <Button asChild>
              <Link href={`/payments?purchaseId=${purchase.data.id}`}>Registrar pago</Link>
            </Button>
          </Can>
          {purchase.data.status === "pedido" ? (
            <Can permission="purchases.create">
              <Button
                disabled={receivePurchase.isPending}
                onClick={() => void receivePurchase.mutateAsync(purchaseId)}
              >
                Recibir pedido
              </Button>
            </Can>
          ) : null}
          <Can permission="purchases.create">
            <Button
              disabled={!canMutate || cancelPurchase.isPending}
              onClick={() => void cancelPurchase.mutateAsync(purchaseId)}
              variant="danger"
            >
              Cancelar
            </Button>
            <Button
              disabled={!canMutate || returnPurchase.isPending}
              onClick={() => void returnPurchase.mutateAsync(purchaseId)}
              variant="secondary"
            >
              Devolver
            </Button>
          </Can>
          </div>
        }
        badge={<p className="text-sm font-medium text-blue-600">Compras</p>}
        description={`Detalle ${getConnectedToApiPhrase()} con proveedor, productos, pagos y estado.`}
        title={`Compra ${purchase.data.purchaseNumber}`}
      />

      {cancelPurchase.error || returnPurchase.error ? (
        <ErrorState
          description={cancelPurchase.error?.message ?? returnPurchase.error?.message}
          title="No pudimos actualizar la compra"
        />
      ) : null}

      <DetailSection description="Datos principales de la compra." title="Resumen">
        <InfoGrid
          items={[
            { label: "Proveedor", value: purchase.data.supplier?.name ?? purchase.data.supplierId },
            { label: "Fecha", value: formatDate(purchase.data.createdAt) },
            {
              label: "Estado",
              value: (
                <Badge variant={statusVariant[purchase.data.status]}>
                  {purchase.data.status}
                </Badge>
              ),
            },
            { label: "Total ref", value: formatRef(purchase.data.totalRef) },
            { label: "Total VES", value: formatVes(purchase.data.totalVes) },
            { label: "Pagado VES", value: formatVes(purchase.data.paidVes) },
            { label: "Saldo VES", value: formatVes(purchaseBalanceVes(purchase.data)) },
            { label: "Tasa", value: formatVes(purchase.data.refRateVes) },
          ]}
        />
      </DetailSection>

      <DetailSection description="Productos incluidos en esta compra." title="Productos">
        <DataTable
          columns={itemColumns}
          data={purchase.data.items}
          getRowId={(item) => `${item.purchaseId}-${item.productId}`}
          loadingRows={3}
        />
      </DetailSection>

      <DetailSection description="Pagos asociados a la compra." title="Pagos">
        <DataTable
          columns={paymentColumns}
          data={purchase.data.payments}
          getRowId={(payment) => payment.id}
          loadingRows={3}
        />
      </DetailSection>
    </div>
  );
}
