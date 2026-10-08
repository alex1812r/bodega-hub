"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";

import { PaymentCancelConfirmModal } from "../components/PaymentCancelConfirmModal";
import { RegisterPaymentModal } from "../components/RegisterPaymentModal";
import { useCancelPayment, usePayment } from "../hooks/usePayments";
import { PaymentDetailBalanceCard } from "./components/PaymentDetailBalanceCard";
import { PaymentDetailHeaderCard } from "./components/PaymentDetailHeaderCard";
import { PaymentDetailInfoCard } from "./components/PaymentDetailInfoCard";
import { PaymentDetailPageHeader } from "./components/PaymentDetailPageHeader";

type PaymentDetailsPageProps = {
  paymentId?: string;
};

function getPaymentCurrency(payment: {
  currency?: "USD" | "VES";
  method: "efectivo_usd" | "efectivo_ves" | "pago_movil" | "punto_venta" | "transferencia";
}) {
  return payment.currency ?? (payment.method === "efectivo_usd" ? "USD" : "VES");
}

export function PaymentDetailsPage({
  paymentId = "pay-001",
}: PaymentDetailsPageProps) {
  const payment = usePayment(paymentId);
  const cancelPayment = useCancelPayment(paymentId);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);

  if (payment.isLoading) {
    return <DetailSkeleton itemsPerSection={4} />;
  }

  // Solo sin datos: si falla un re-pedido con el pago ya cargado, el detalle (y el
  // modal de «Registrar otro pago» abierto) siguen en pantalla.
  if (!payment.data) {
    return (
      <ErrorState
        description={
          payment.error instanceof Error
            ? payment.error.message
            : "No pudimos cargar el detalle del pago."
        }
        onRetry={() => void payment.refetch()}
        title="No pudimos cargar el pago"
      />
    );
  }

  const data = payment.data;
  const linkedDocument = data.relatedDocument ?? data.documentBalance;
  const isCancelled = data.status === "anulado";
  // Otro pago solo tiene sentido sobre el mismo documento (una venta o una compra).
  const canRegisterAnotherPayment =
    !isCancelled && Boolean(data.saleId) !== Boolean(data.purchaseId);

  function handleCancelPayment() {
    // `mutate` no rechaza: si falla, el modal sigue abierto y muestra `cancelPayment.error`.
    cancelPayment.mutate(paymentId, {
      onSuccess: () => setIsCancelModalOpen(false),
    });
  }

  function handleCancelModalOpenChange(open: boolean) {
    setIsCancelModalOpen(open);

    if (!open) {
      // Que el rechazo no reaparezca al volver a abrir el modal.
      cancelPayment.reset();
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PaymentDetailPageHeader />

      <PaymentDetailHeaderCard
        isCancelling={cancelPayment.isPending}
        onCancel={() => setIsCancelModalOpen(true)}
        paymentId={data.id}
        registerPaymentAction={
          canRegisterAnotherPayment ? (
            <RegisterPaymentModal
              purchaseId={data.purchaseId}
              saleId={data.saleId}
              trigger={
                <Button className="gap-2 shadow-sm" size="sm" type="button">
                  <Plus aria-hidden className="size-[1.125rem]" />
                  Registrar otro pago
                </Button>
              }
            />
          ) : undefined
        }
        status={data.status}
      />

      <PaymentCancelConfirmModal
        error={cancelPayment.error?.message}
        isConfirming={cancelPayment.isPending}
        onConfirm={handleCancelPayment}
        onOpenChange={handleCancelModalOpenChange}
        open={isCancelModalOpen}
        paymentId={data.id}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <PaymentDetailInfoCard
            amountRef={data.amountRef}
            amountVes={data.amountVes}
            bankName={data.bankName}
            createdAt={data.createdAt}
            createdByName={data.createdBy?.name}
            currency={getPaymentCurrency(data)}
            linkedDocument={linkedDocument}
            method={data.method}
            notes={data.notes}
            phone={data.phone}
            referenceCode={data.referenceCode}
            refRateVes={data.refRateVes}
          />
        </div>
        <div className="lg:col-span-4">
          <PaymentDetailBalanceCard
            documentBalance={data.documentBalance}
            refRateVes={data.refRateVes}
          />
        </div>
      </div>
    </div>
  );
}
