"use client";

import Link from "next/link";

import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { DetailSection } from "@/shared/components/DetailSection";
import { ErrorState } from "@/shared/components/ErrorState";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { PageHeader } from "@/shared/components/PageHeader";
import { formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import { RegisterPaymentModal } from "../components/RegisterPaymentModal";
import { usePayment } from "../hooks/usePayments";
import { PaymentMethodDetailsCard } from "./components/PaymentMethodDetailsCard";
import { PaymentTimeline } from "./components/PaymentTimeline";

type PaymentDetailsPageProps = {
  paymentId?: string;
};

function getPaymentContextLabel(payment: {
  purchaseId?: string;
  saleId?: string;
}) {
  if (payment.saleId) {
    return `venta ${payment.saleId}`;
  }

  if (payment.purchaseId) {
    return `compra ${payment.purchaseId}`;
  }

  return "documento sin contexto";
}

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

  if (payment.isLoading) {
    return <DetailSkeleton itemsPerSection={4} />;
  }

  if (payment.error || !payment.data) {
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

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <>
            <Button asChild className="w-full sm:w-auto" variant="outline">
              <Link href="/payments">Volver</Link>
            </Button>
            <RegisterPaymentModal
              purchaseId={payment.data.purchaseId}
              saleId={payment.data.saleId}
              trigger={<Button className="w-full sm:w-auto">Registrar otro pago</Button>}
            />
            <Button
              className="w-full sm:w-auto"
              disabled
              title="Pendiente: no existe endpoint de anulacion"
              variant="danger"
            >
              Anular pago
            </Button>
          </>
        }
        badge={<p className="text-sm font-medium text-blue-600">Pagos</p>}
        description="Detalle del pago, metodo usado y trazabilidad conectada a la API."
        title={`Pago ${payment.data.id}`}
      />

      <DetailSection description="Relacion del pago con el documento origen." title="Resumen">
        <InfoGrid
          items={[
            {
              label: "Contacto",
              value: payment.data.contact?.name ?? payment.data.contactId,
            },
            { label: "Contexto", value: getPaymentContextLabel(payment.data) },
            { label: "Fecha", value: formatDate(payment.data.createdAt) },
            { label: "Tasa ref", value: formatVes(payment.data.refRateVes) },
            {
              label: "Saldo pendiente",
              value:
                payment.data.pendingBalanceVes !== undefined
                  ? formatVes(payment.data.pendingBalanceVes)
                  : "No informado",
            },
          ]}
        />
      </DetailSection>

      <PaymentMethodDetailsCard
        payment={{
          ...payment.data,
          currency: getPaymentCurrency(payment.data),
        }}
      />
      <PaymentTimeline
        items={[
          {
            description: `Pago asociado a ${getPaymentContextLabel(payment.data)}.`,
            id: `${payment.data.id}-created`,
            timestamp: formatDate(payment.data.createdAt),
            title: "Pago registrado",
          },
          {
            description:
              "La anulacion queda pendiente hasta que exista un endpoint de API.",
            id: `${payment.data.id}-cancel-pending`,
            timestamp: "Pendiente",
            title: "Anular pago pendiente",
          },
        ]}
      />
    </div>
  );
}
