"use client";

import { useCallback, useState } from "react";

import { RegisterPaymentModal } from "@/modules/payments/components/RegisterPaymentModal";
import type { PaymentDetail } from "@/modules/payments/hooks/usePayments";
import { useSettings } from "@/modules/settings/hooks/useSettings";
import { usePermission } from "@/shared/auth/usePermission";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

import {
  useCancelSale,
  useReturnSale,
  useSale,
} from "../hooks/useSales";
import { exportSaleInvoicePdf } from "./services/exportSaleInvoicePdf";
import { SaleDetailCustomerCard } from "./components/SaleDetailCustomerCard";
import { SaleDetailHeader } from "./components/SaleDetailHeader";
import { SaleDetailPaymentsTable } from "./components/SaleDetailPaymentsTable";
import { SaleDetailProductsTable } from "./components/SaleDetailProductsTable";
import { SaleDetailReceiptPreview } from "./components/SaleDetailReceiptPreview";
import { SaleDetailSellerCard } from "./components/SaleDetailSellerCard";
import { SaleDetailTotals } from "./components/SaleDetailTotals";
import { resolveSeller } from "./utils/resolveSeller";

type SaleDetailsPageProps = {
  saleId?: string;
};

export function SaleDetailsPage({ saleId = "sale-001" }: SaleDetailsPageProps) {
  const sale = useSale(saleId);
  const settings = useSettings();
  const cancelSale = useCancelSale(saleId);
  const returnSale = useReturnSale(saleId);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const { can } = usePermission();

  // El modal deja abonar varias veces seguidas; cuando el servidor confirma que el
  // saldo quedó en 0 ya no hay nada que cobrar y se cierra solo.
  const handlePaymentRegistered = useCallback((payment: PaymentDetail) => {
    if (payment.pendingBalanceVes !== undefined && roundMoney(payment.pendingBalanceVes) <= 0) {
      setIsCollecting(false);
    }
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (!saleId) {
      return;
    }

    setIsExportingPdf(true);

    try {
      await exportSaleInvoicePdf(saleId, {
        companyName: settings.data?.businessName ?? undefined,
      });
    } finally {
      setIsExportingPdf(false);
    }
  }, [saleId, settings.data?.businessName]);

  if (sale.isLoading) {
    return <DetailSkeleton />;
  }

  // Solo sin datos: si falla un re-pedido con la venta ya cargada, el detalle (y el
  // modal de cobro abierto) siguen en pantalla.
  if (!sale.data) {
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

  const data = sale.data;
  const pendingVes = Math.max(0, data.totalVes - data.paidVes);
  const hasBalance = roundMoney(pendingVes) > 0;
  const seller = resolveSeller(data.userId);
  const companyName = settings.data?.businessName ?? undefined;
  // Mismas reglas que el servidor: `register_payment` solo cobra ventas pagadas o
  // pendientes (no borrador, anulada ni devuelta) con saldo, y `POST /api/payments`
  // exige `payments.manage` o `sales.create`.
  const canCollectBalance =
    hasBalance &&
    (data.status === "pendiente_pago" || data.status === "pagada") &&
    (can("payments.manage") || can("sales.create"));
  // Un pago anulado sigue en el historial, pero no cuenta como cobro.
  const activePayments = data.payments.filter((payment) => payment.status !== "anulado").length;
  const customerName = data.customer?.name ?? data.customerId;
  const receipt = {
    cashierName: seller.name,
    companyName,
    createdAt: data.createdAt,
    customer: data.customer,
    discountRef: data.discountRef,
    invoiceNumber: data.invoiceNumber,
    items: data.items,
    refRateVes: data.refRateVes,
    subtotalRef: data.subtotalRef,
    taxRef: data.taxRef,
    totalRef: data.totalRef,
    totalVes: data.totalVes,
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <SaleDetailHeader
        canCollectBalance={canCollectBalance}
        createdAt={data.createdAt}
        invoiceNumber={data.invoiceNumber}
        isCancelling={cancelSale.isPending}
        isExportingPdf={isExportingPdf}
        isReturning={returnSale.isPending}
        onCancel={() => cancelSale.mutate(saleId)}
        onCollect={() => setIsCollecting(true)}
        onDownloadPdf={() => void handleDownloadPdf()}
        onPrint={handlePrint}
        onReturn={() => returnSale.mutate(saleId)}
        paidVes={data.paidVes}
        pendingVes={pendingVes}
        status={data.status}
        totalRef={data.totalRef}
        totalVes={data.totalVes}
      />

      {canCollectBalance || isCollecting ? (
        <RegisterPaymentModal
          onOpenChange={setIsCollecting}
          onRegistered={handlePaymentRegistered}
          open={isCollecting}
          saleId={data.id}
        />
      ) : null}

      {cancelSale.error || returnSale.error ? (
        <ErrorState
          description={
            (cancelSale.error ?? returnSale.error) instanceof Error
              ? (cancelSale.error ?? returnSale.error)?.message
              : "No se pudo completar la acción."
          }
          title="No pudimos actualizar la venta"
        />
      ) : null}

      <CollapsibleSection
        defaultOpen
        storageKey="sale-detail:products-open"
        summary={`${data.items.length === 1 ? "1 producto" : `${data.items.length} productos`} · total ${formatRefUsd(data.totalRef)}`}
        title="Productos"
      >
        <div className="space-y-4">
          <SaleDetailProductsTable items={data.items} />
          <SaleDetailTotals
            discountRef={data.discountRef}
            refRateVes={data.refRateVes}
            subtotalRef={data.subtotalRef}
            taxRef={data.taxRef}
            totalRef={data.totalRef}
            totalVes={data.totalVes}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen={hasBalance}
        storageKey="sale-detail:payments-open"
        summary={
          activePayments === 0
            ? "Sin pagos registrados"
            : `${activePayments === 1 ? "1 pago" : `${activePayments} pagos`} · cobrado ${formatVesBs(data.paidVes)}`
        }
        title="Pagos"
      >
        <SaleDetailPaymentsTable payments={data.payments} />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="sale-detail:parties-open"
        summary={`${customerName} · vendió ${seller.name}`}
        title="Cliente / Vendedor"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SaleDetailCustomerCard customer={data.customer} customerId={data.customerId} />
          <SaleDetailSellerCard seller={seller} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="sale-detail:receipt-open"
        summary="Ticket de 80 mm tal como se imprime"
        title="Vista previa del recibo"
      >
        <SaleDetailReceiptPreview {...receipt} id="sale-receipt-screen-preview" />
      </CollapsibleSection>

      {/*
        Copia solo para imprimir: las reglas de impresión (globals.css) pintan
        `#sale-receipt-preview`, y una sección colapsada no se imprime. Así el
        ticket sale igual con la vista previa abierta o cerrada.
      */}
      <div aria-hidden="true" className="sale-detail-receipt-aside hidden print:block">
        <SaleDetailReceiptPreview {...receipt} />
      </div>
    </div>
  );
}
