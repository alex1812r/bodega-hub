"use client";

import { useCallback, useState } from "react";

import { useSettings } from "@/modules/settings/hooks/useSettings";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";

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

  const data = sale.data;
  const pendingVes = Math.max(0, data.totalVes - data.paidVes);
  const seller = resolveSeller(data.userId);
  const companyName = settings.data?.businessName ?? undefined;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <SaleDetailHeaderCard
        createdAt={data.createdAt}
        invoiceNumber={data.invoiceNumber}
        isCancelling={cancelSale.isPending}
        isExportingPdf={isExportingPdf}
        isReturning={returnSale.isPending}
        onCancel={() => void handleCancelSale()}
        onDownloadPdf={() => void handleDownloadPdf()}
        onPrint={handlePrint}
        onReturn={() => void handleReturnSale()}
        saleId={data.id}
        status={data.status}
      />

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
    </div>
  );
}
