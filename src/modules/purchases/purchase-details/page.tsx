"use client";

import { useState } from "react";

import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";

import {
  useCancelPurchase,
  usePurchase,
  useReceivePurchase,
  useReturnPurchase,
} from "../hooks/usePurchases";
import { PurchaseDetailDatesCard } from "./components/PurchaseDetailDatesCard";
import { PurchaseDetailFinancialCard } from "./components/PurchaseDetailFinancialCard";
import { PurchaseDetailHeaderCard } from "./components/PurchaseDetailHeaderCard";
import { PurchaseDetailInfoBanner } from "./components/PurchaseDetailInfoBanner";
import { PurchaseDetailPageHeader } from "./components/PurchaseDetailPageHeader";
import { PurchaseDetailPaymentStatusCard } from "./components/PurchaseDetailPaymentStatusCard";
import { PurchaseDetailPaymentsTable } from "./components/PurchaseDetailPaymentsTable";
import { PurchaseDetailProductsTable } from "./components/PurchaseDetailProductsTable";
import { PurchaseDetailSupplierCard } from "./components/PurchaseDetailSupplierCard";
import { exportPurchaseDetailPdf } from "./services/exportPurchaseDetailPdf";

type PurchaseDetailsPageProps = {
  purchaseId?: string;
};

export function PurchaseDetailsPage({
  purchaseId = "purchase-001",
}: PurchaseDetailsPageProps) {
  const purchase = usePurchase(purchaseId);
  const exchangeRate = useCurrentExchangeRate();
  const cancelPurchase = useCancelPurchase(purchaseId);
  const receivePurchase = useReceivePurchase(purchaseId);
  const returnPurchase = useReturnPurchase(purchaseId);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  async function handleExportPdf() {
    setIsExportingPdf(true);

    try {
      const result = await purchase.refetch();

      if (result.data) {
        exportPurchaseDetailPdf(result.data);
      }
    } finally {
      setIsExportingPdf(false);
    }
  }

  if (purchase.isLoading) {
    return <DetailSkeleton itemsPerSection={4} />;
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

  const data = purchase.data;
  const paidRef = data.paidRef ?? 0;
  const pendingRef = Math.max(0, Math.round((data.totalRef - paidRef) * 100) / 100);
  const currentRateVes = exchangeRate.data?.rateVes ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PurchaseDetailPageHeader />

      <PurchaseDetailHeaderCard
        isCancelling={cancelPurchase.isPending}
        isExportingPdf={isExportingPdf}
        isReceiving={receivePurchase.isPending}
        isReturning={returnPurchase.isPending}
        onCancel={() => {
          void cancelPurchase.mutateAsync(purchaseId);
        }}
        onExportPdf={handleExportPdf}
        onReceive={() => {
          void receivePurchase.mutateAsync(purchaseId);
        }}
        onReturn={() => {
          void returnPurchase.mutateAsync(purchaseId);
        }}
        purchaseId={data.id}
        purchaseNumber={data.purchaseNumber}
        status={data.status}
      />

      {cancelPurchase.error || returnPurchase.error || receivePurchase.error ? (
        <ErrorState
          description={
            (cancelPurchase.error ?? returnPurchase.error ?? receivePurchase.error) instanceof
            Error
              ? (cancelPurchase.error ?? returnPurchase.error ?? receivePurchase.error)?.message
              : "No se pudo completar la acción."
          }
          title="No pudimos actualizar la compra"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <PurchaseDetailSupplierCard supplier={data.supplier} supplierId={data.supplierId} />
        <PurchaseDetailDatesCard createdAt={data.createdAt} />
        <PurchaseDetailFinancialCard
          refRateVes={data.refRateVes}
          totalRef={data.totalRef}
          totalVes={data.totalVes}
        />
        <PurchaseDetailPaymentStatusCard
          currentRateVes={currentRateVes}
          paidRef={paidRef}
          paidVes={data.paidVes}
          pendingRef={pendingRef}
        />
      </div>

      <PurchaseDetailInfoBanner
        createdAt={data.createdAt}
        notes={data.notes}
        status={data.status}
        updatedAt={data.updatedAt}
      />

      <PurchaseDetailProductsTable
        discountRef={data.discountRef}
        discountVes={data.discountVes ?? 0}
        items={data.items}
        taxRef={data.taxRef}
        taxVes={data.taxVes ?? 0}
        totalRef={data.totalRef}
        totalVes={data.totalVes}
      />
      <PurchaseDetailPaymentsTable payments={data.payments} />
    </div>
  );
}
