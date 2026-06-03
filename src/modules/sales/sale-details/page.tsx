"use client";

import Link from "next/link";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { DetailSection } from "@/shared/components/DetailSection";
import { ErrorState } from "@/shared/components/ErrorState";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { PageHeader } from "@/shared/components/PageHeader";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import { Can } from "@/shared/auth/Can";
import {
  type SaleItemWithProduct,
  useCancelSale,
  useReturnSale,
  useSale,
  useSaleReceipt,
} from "../hooks/useSales";

type SaleDetailsPageProps = {
  saleId?: string;
};

const statusVariant = {
  borrador: "default",
  cancelada: "danger",
  devuelta: "warning",
  pagada: "success",
  pendiente_pago: "warning",
} as const;

const statusLabel = {
  borrador: "borrador",
  cancelada: "cancelada",
  devuelta: "devuelta",
  pagada: "pagada",
  pendiente_pago: "pendiente pago",
} as const;

const columns: DataTableColumn<SaleItemWithProduct>[] = [
  {
    header: "Producto",
    key: "product",
    render: (row) => row.product?.name ?? row.productId,
  },
  { header: "Cantidad", key: "quantity", render: (row) => row.quantity },
  {
    header: "Precio ref",
    key: "unitPriceRef",
    render: (row) => formatRef(row.unitPriceRef),
  },
  {
    header: "Subtotal ref",
    key: "subtotalRef",
    render: (row) => formatRef(row.subtotalRef),
  },
];

export function SaleDetailsPage({ saleId = "sale-001" }: SaleDetailsPageProps) {
  const sale = useSale(saleId);
  const receipt = useSaleReceipt(saleId);
  const cancelSale = useCancelSale(saleId);
  const returnSale = useReturnSale(saleId);

  async function handleCancelSale() {
    await cancelSale.mutateAsync(saleId);
  }

  async function handleReturnSale() {
    await returnSale.mutateAsync(saleId);
  }

  if (sale.isLoading) {
    return <DetailSkeleton />;
  }

  if (sale.error || !sale.data) {
    return (
      <ErrorState
        description={
          sale.error instanceof Error
            ? sale.error.message
            : "No pudimos cargar el detalle de la venta."
        }
        onRetry={() => void sale.refetch()}
        title="No pudimos cargar la venta"
      />
    );
  }

  const pendingVes = sale.data.totalVes - sale.data.paidVes;

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/payments?saleId=${sale.data.id}`}>Ver pagos</Link>
          </Button>
          <Can permission="payments.manage">
            <Button asChild>
              <Link href={`/payments?saleId=${sale.data.id}`}>Registrar pago</Link>
            </Button>
          </Can>
          <Can permission="sales.create">
            <Button
              disabled={cancelSale.isPending || sale.data.status === "cancelada"}
              onClick={() => void handleCancelSale()}
              variant="danger"
            >
              {cancelSale.isPending ? "Anulando..." : "Anular"}
            </Button>
            <Button
              disabled={returnSale.isPending || sale.data.status === "devuelta"}
              onClick={() => void handleReturnSale()}
              variant="outline"
            >
              {returnSale.isPending ? "Procesando..." : "Devolver"}
            </Button>
          </Can>
          </div>
        }
        badge={<p className="text-sm font-medium text-blue-600">Ventas</p>}
        description="Detalle de productos, cliente, totales y estado de pago conectado a la API."
        title={`Venta ${sale.data.invoiceNumber}`}
      />

      <DetailSection description="Datos principales de la venta." title="Resumen">
        <InfoGrid
          items={[
            { label: "Cliente", value: sale.data.customer?.name ?? sale.data.customerId },
            { label: "Fecha", value: formatDate(sale.data.createdAt) },
            {
              label: "Estado",
              value: (
                <Badge variant={statusVariant[sale.data.status]}>
                  {statusLabel[sale.data.status]}
                </Badge>
              ),
            },
            { label: "Tasa ref", value: formatVes(sale.data.refRateVes) },
            { label: "Subtotal ref", value: formatRef(sale.data.subtotalRef) },
            { label: "Descuento ref", value: formatRef(sale.data.discountRef) },
            { label: "Impuesto ref", value: formatRef(sale.data.taxRef) },
            { label: "Total ref", value: formatRef(sale.data.totalRef) },
            { label: "Total VES", value: formatVes(sale.data.totalVes) },
            { label: "Pagado VES", value: formatVes(sale.data.paidVes) },
            { label: "Pendiente VES", value: formatVes(pendingVes) },
          ]}
        />
      </DetailSection>

      <DetailSection description="Productos incluidos en esta venta." title="Items">
        <DataTable
          columns={columns}
          data={sale.data.items}
          getRowId={(row) => `${row.saleId}-${row.productId}`}
        />
      </DetailSection>

      <DetailSection description="Datos listos para imprimir o compartir." title="Recibo">
        {receipt.error ? (
          <ErrorState
            description={
              receipt.error instanceof Error
                ? receipt.error.message
                : "No pudimos cargar el recibo."
            }
            onRetry={() => void receipt.refetch()}
            title="No pudimos cargar el recibo"
          />
        ) : (
          <div className="space-y-4">
            <InfoGrid
              items={[
                {
                  label: "Numero",
                  value: receipt.isLoading ? "Cargando..." : receipt.data?.invoiceNumber,
                },
                {
                  label: "Cliente",
                  value: receipt.data?.customer?.name ?? sale.data.customer?.name ?? "—",
                },
                {
                  label: "Total recibo",
                  value: receipt.data ? formatVes(receipt.data.totalVes) : "Cargando...",
                },
                {
                  label: "Pagado",
                  value: receipt.data ? formatVes(receipt.data.paidVes) : "Cargando...",
                },
                {
                  label: "Pendiente",
                  value: receipt.data ? formatVes(receipt.data.pendingVes) : "Cargando...",
                },
              ]}
            />
            <DataTable
              columns={columns}
              data={receipt.data?.items ?? []}
              getRowId={(row) => row.productId}
              isLoading={receipt.isLoading}
              loadingRows={3}
            />
          </div>
        )}
      </DetailSection>

      {cancelSale.error || returnSale.error ? (
        <ErrorState
          description={
            (cancelSale.error ?? returnSale.error) instanceof Error
              ? (cancelSale.error ?? returnSale.error)?.message
              : "No se pudo completar la accion."
          }
          title="No pudimos actualizar la venta"
        />
      ) : null}
    </div>
  );
}
