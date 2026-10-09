"use client";

import { useCallback, useState } from "react";

import { DocumentStockMovementsLink } from "@/modules/inventory/components/DocumentStockMovementsLink";
import { RegisterPaymentModal } from "@/modules/payments/components/RegisterPaymentModal";
import type { PaymentDetail } from "@/modules/payments/hooks/usePayments";
import { useSettings } from "@/modules/settings/hooks/useSettings";
import { usePermission } from "@/shared/auth/usePermission";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { useToast } from "@/shared/components/Toast";
import { useCurrentUrl } from "@/shared/hooks/useCurrentUrl";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { withChainedReturnTo } from "@/shared/utils/returnTo";

import { SaleCancelConfirmModal } from "../components/SaleCancelConfirmModal";
import { SaleReturnConfirmModal } from "../components/SaleReturnConfirmModal";

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
import { formatInvoiceHeading } from "./utils/saleDetailLabels";

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
  // Anular y devolver se confirman con su efecto a la vista (CNF-02/03).
  const [confirming, setConfirming] = useState<"cancel" | "return" | null>(null);
  const { can } = usePermission();
  const { showToast } = useToast();
  // URL del detalle con el `returnTo` con el que se llegó: los enlaces que salen de
  // aquí la llevan entera, para volver a esta venta sin perder su lista de origen.
  const detailUrl = useCurrentUrl();

  // Al volver de un enlace del detalle, el scroll queda donde estaba.
  useScrollRestoration(detailUrl, { ready: Boolean(sale.data) });

  // El modal deja abonar varias veces seguidas; cuando el servidor confirma que el
  // saldo quedó en 0 ya no hay nada que cobrar y se cierra solo.
  const handlePaymentRegistered = useCallback((payment: PaymentDetail) => {
    if (payment.pendingBalanceVes !== undefined && roundMoney(payment.pendingBalanceVes) <= 0) {
      setIsCollecting(false);
    }
  }, []);

  function openConfirmation(action: "cancel" | "return") {
    // Un rechazo de un intento anterior no pertenece a esta apertura.
    cancelSale.reset();
    returnSale.reset();
    setConfirming(action);
  }

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
  // Un borrador aún no descontó stock; una venta anulada o devuelta conserva sus
  // movimientos (la salida y su reverso).
  const movedStock = data.status !== "borrador";
  const invoiceHeading = formatInvoiceHeading(data.invoiceNumber);
  const paymentsHref = can("payments.view")
    ? withChainedReturnTo(`/payments?saleId=${data.id}`, detailUrl)
    : undefined;

  // Si la RPC rechaza (carrera entre el efecto y la ejecución), `mutateAsync`
  // rechaza: el modal sigue abierto y muestra el mensaje.
  async function handleConfirmCancel() {
    await cancelSale.mutateAsync(data.id);
    setConfirming(null);
    showToast({ title: `Venta ${invoiceHeading} anulada`, tone: "success" });
  }

  async function handleConfirmReturn() {
    await returnSale.mutateAsync(data.id);
    setConfirming(null);
    showToast({ title: `Venta ${invoiceHeading} devuelta`, tone: "success" });
  }

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
        onCancel={() => openConfirmation("cancel")}
        onCollect={() => setIsCollecting(true)}
        onDownloadPdf={() => void handleDownloadPdf()}
        onPrint={handlePrint}
        onReturn={() => openConfirmation("return")}
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

      <SaleCancelConfirmModal
        error={cancelSale.error?.message}
        isPending={cancelSale.isPending}
        onConfirm={handleConfirmCancel}
        onOpenChange={(open) => setConfirming(open ? "cancel" : null)}
        onUseReturn={() => openConfirmation("return")}
        open={confirming === "cancel"}
        paymentsHref={paymentsHref}
        saleId={data.id}
      />
      <SaleReturnConfirmModal
        error={returnSale.error?.message}
        isPending={returnSale.isPending}
        onConfirm={handleConfirmReturn}
        onOpenChange={(open) => setConfirming(open ? "return" : null)}
        open={confirming === "return"}
        paymentsHref={paymentsHref}
        saleId={data.id}
      />

      <CollapsibleSection
        defaultOpen
        storageKey="sale-detail:products-open"
        summary={`${data.items.length === 1 ? "1 producto" : `${data.items.length} productos`} · total ${formatRefUsd(data.totalRef)}`}
        title="Productos"
      >
        <div className="space-y-4">
          <SaleDetailProductsTable
            canViewProducts={can("products.view")}
            detailUrl={detailUrl}
            items={data.items}
          />
          <SaleDetailTotals
            discountRef={data.discountRef}
            refRateVes={data.refRateVes}
            subtotalRef={data.subtotalRef}
            taxRef={data.taxRef}
            totalRef={data.totalRef}
            totalVes={data.totalVes}
          />
          {can("inventory.view") && movedStock ? (
            <div className="flex justify-end px-4">
              <DocumentStockMovementsLink
                currentUrl={detailUrl}
                document={{ id: data.id, kind: "venta" }}
              />
            </div>
          ) : null}
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
