"use client";

import { useCallback, useState } from "react";

import { RegisterPaymentModal } from "@/modules/payments/components/RegisterPaymentModal";
import type { PaymentDetail } from "@/modules/payments/hooks/usePayments";
import { useSettings } from "@/modules/settings/hooks/useSettings";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { roundMoney } from "@/shared/utils/currency";

import {
  useCancelSale,
  useReturnSale,
  useSale,
} from "../hooks/useSales";
import { exportSaleInvoicePdf } from "./services/exportSaleInvoicePdf";
import { SaleDetailCustomerCard } from "./components/SaleDetailCustomerCard";
import { SaleDetailFinancialSummary } from "./components/SaleDetailFinancialSummary";
import { SaleDetailHeaderCard } from "./components/SaleDetailHeaderCard";
import { SaleDetailPaymentsTable } from "./components/SaleDetailPaymentsTable";
import { SaleDetailProductsTable } from "./components/SaleDetailProductsTable";
import { SaleDetailReceiptPreview } from "./components/SaleDetailReceiptPreview";
import { SaleDetailSellerCard } from "./components/SaleDetailSellerCard";
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

  const data = sale.data;
  const pendingVes = Math.max(0, data.totalVes - data.paidVes);
  const seller = resolveSeller(data.userId);
  const companyName = settings.data?.businessName ?? undefined;
  // Mismas reglas que el servidor: `register_payment` solo cobra ventas pagadas o
  // pendientes (no borrador, anulada ni devuelta) con saldo, y `POST /api/payments`
  // exige `payments.manage` o `sales.create`.
  const canCollectBalance =
    roundMoney(pendingVes) > 0 &&
    (data.status === "pendiente_pago" || data.status === "pagada") &&
    (can("payments.manage") || can("sales.create"));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <SaleDetailHeaderCard
        createdAt={data.createdAt}
        invoiceNumber={data.invoiceNumber}
        isCancelling={cancelSale.isPending}
        isExportingPdf={isExportingPdf}
        isReturning={returnSale.isPending}
        onCancel={() => cancelSale.mutate(saleId)}
        onDownloadPdf={() => void handleDownloadPdf()}
        onPrint={handlePrint}
        onReturn={() => returnSale.mutate(saleId)}
        primaryAction={
          canCollectBalance ? (
            <Button onClick={() => setIsCollecting(true)} size="sm" type="button">
              Cobrar saldo
            </Button>
          ) : null
        }
        status={data.status}
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SaleDetailCustomerCard
              customer={data.customer}
              customerId={data.customerId}
            />
            <SaleDetailSellerCard seller={seller} />
          </div>

          <SaleDetailFinancialSummary
            discountRef={data.discountRef}
            paidVes={data.paidVes}
            pendingVes={pendingVes}
            refRateVes={data.refRateVes}
            subtotalRef={data.subtotalRef}
            taxRef={data.taxRef}
            totalRef={data.totalRef}
            totalVes={data.totalVes}
          />

          <SaleDetailProductsTable items={data.items} />
          <SaleDetailPaymentsTable payments={data.payments} />
        </div>

        <aside className="sale-detail-receipt-aside flex flex-col gap-4 xl:sticky xl:top-[5.5rem] xl:self-start">
          <SaleDetailReceiptPreview
            cashierName={seller.name}
            companyName={companyName}
            createdAt={data.createdAt}
            customer={data.customer}
            discountRef={data.discountRef}
            invoiceNumber={data.invoiceNumber}
            items={data.items}
            refRateVes={data.refRateVes}
            subtotalRef={data.subtotalRef}
            taxRef={data.taxRef}
            totalRef={data.totalRef}
            totalVes={data.totalVes}
          />
        </aside>
      </div>
    </div>
  );
}
