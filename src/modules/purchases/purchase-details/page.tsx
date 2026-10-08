"use client";

import { useState } from "react";

import { RegisterPaymentModal } from "@/modules/payments/components/RegisterPaymentModal";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { PurchaseRepriceNotice } from "@/modules/products/components/price-review/PurchaseRepriceNotice";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { roundMoney } from "@/shared/utils/currency";

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
import { PurchasePendingReceiptBanner } from "./components/PurchasePendingReceiptBanner";
import { PurchaseReceivePreviewModal } from "./components/PurchaseReceivePreviewModal";
import { exportPurchaseDetailPdf } from "./services/exportPurchaseDetailPdf";
import { buildReceivePreview, type ReceivePreviewLine } from "./utils/buildReceivePreview";

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
  const { can, role } = usePermission();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  // Líneas de la previsualización, fijadas al abrir el modal: si la recepción falla
  // y el detalle se refresca, el modal sigue mostrando lo que se intentó recibir.
  const [receivePreview, setReceivePreview] = useState<ReceivePreviewLine[] | null>(null);

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

  async function handleConfirmReceive() {
    try {
      await receivePurchase.mutateAsync(purchaseId);
      setReceivePreview(null);
    } catch {
      // El mensaje del servidor queda en el modal; el detalle se vuelve a pedir
      // por si la compra ya no está en pedido (p. ej. la recibió otra persona).
      await purchase.refetch();
    }
  }

  if (purchase.isLoading) {
    return <DetailSkeleton itemsPerSection={4} />;
  }

  // Solo sin datos: si falla un re-pedido con la compra ya cargada, el detalle (y el
  // modal de pago abierto) siguen en pantalla.
  if (!purchase.data) {
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
  // "Pagar" sigue las reglas de `register_payment` y de POST /api/payments: el saldo
  // es el de bolívares (total − pagado), una compra cancelada o devuelta no admite
  // pagos, y solo paga quien tiene `payments.manage` y no es vendedor.
  const pendingVes = roundMoney(data.totalVes - data.paidVes);
  // Los pagos individuales de la compra solo llegan a quien puede ver pagos de
  // compras (admin, contador). A los demás el BFF les manda `payments: []`: no es
  // "sin pagos", así que el historial lo dice. Pagado / Pendiente vienen de la compra.
  const canViewPayments = role !== undefined && canViewPurchasePayments(role);
  const canPay =
    pendingVes > 0 &&
    data.status !== "cancelado" &&
    data.status !== "devuelto" &&
    can("payments.manage") &&
    canViewPayments;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PurchaseDetailPageHeader />

      {data.status === "pedido" ? (
        <PurchasePendingReceiptBanner
          canReceive={can("purchases.create")}
          isReceiving={receivePurchase.isPending}
          onReceive={() => setReceivePreview(buildReceivePreview(data))}
        />
      ) : null}

      <PurchaseDetailHeaderCard
        isCancelling={cancelPurchase.isPending}
        isExportingPdf={isExportingPdf}
        isReturning={returnPurchase.isPending}
        onCancel={() => {
          void cancelPurchase.mutateAsync(purchaseId);
        }}
        onExportPdf={handleExportPdf}
        onReturn={() => {
          void returnPurchase.mutateAsync(purchaseId);
        }}
        primaryAction={
          canPay ? (
            <Button className="flex-1 md:flex-none" onClick={() => setIsPaying(true)} type="button">
              Pagar
            </Button>
          ) : null
        }
        purchaseNumber={data.purchaseNumber}
        status={data.status}
      />

      {cancelPurchase.error || returnPurchase.error ? (
        <ErrorState
          description={
            (cancelPurchase.error ?? returnPurchase.error) instanceof Error
              ? (cancelPurchase.error ?? returnPurchase.error)?.message
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
      <PurchaseRepriceNotice purchaseId={data.id} />

      <PurchaseDetailProductsTable
        discountRef={data.discountRef}
        discountVes={data.discountVes ?? 0}
        items={data.items}
        taxRef={data.taxRef}
        taxVes={data.taxVes ?? 0}
        totalRef={data.totalRef}
        totalVes={data.totalVes}
      />
      {/* Sin rol aún no se sabe cuál de los dos historiales toca: no se pinta ninguno. */}
      {role === undefined ? null : (
        <PurchaseDetailPaymentsTable canViewPayments={canViewPayments} payments={data.payments} />
      )}

      {/* Sigue montado aunque la compra ya no esté en pedido: el error de una
          recepción repetida tiene que seguir a la vista hasta que se cierre. */}
      {receivePreview ? (
        <PurchaseReceivePreviewModal
          error={receivePurchase.error instanceof Error ? receivePurchase.error.message : null}
          isPending={receivePurchase.isPending}
          lines={receivePreview}
          onConfirm={handleConfirmReceive}
          onOpenChange={(open) => {
            if (!open) {
              setReceivePreview(null);
              receivePurchase.reset();
            }
          }}
          open
          purchaseNumber={data.purchaseNumber}
        />
      ) : null}

      {/* Abierto sigue montado aunque la compra ya no admita pagos: un pago de
          resultado incierto pudo saldarla y su error tiene que seguir a la vista. */}
      {canPay || isPaying ? (
        <RegisterPaymentModal
          onOpenChange={setIsPaying}
          // Con la compra saldada no queda nada que abonar: el modal se cierra solo.
          // Tras un abono parcial sigue abierto, con el saldo que resta.
          onRegistered={(payment) => {
            if (payment.pendingBalanceVes !== undefined && payment.pendingBalanceVes <= 0) {
              setIsPaying(false);
            }
          }}
          open={isPaying}
          purchaseId={data.id}
        />
      ) : null}
    </div>
  );
}
