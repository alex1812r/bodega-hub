"use client";

import { FileText, Wallet } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { PackDistributionValue } from "@/modules/inventory/inventory-movements/utils/packDistribution";
import { useRequestAttempt } from "@/modules/inventory/utils/requestAttempt";
import { RegisterPaymentModal } from "@/modules/payments/components/RegisterPaymentModal";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import type { PrimaryStateActionConfig } from "@/shared/components/PrimaryStateAction";
import { roundMoney } from "@/shared/utils/currency";
import { PurchaseRepriceNotice } from "@/modules/products/components/price-review/PurchaseRepriceNotice";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";

import {
  useCancelPurchase,
  usePurchase,
  useReceivePurchase,
  useReturnPurchase,
} from "../hooks/usePurchases";
import { describePurchaseRequestError } from "../purchase-create/utils/purchaseConfirmError";
import { getPurchaseActions } from "../utils/purchaseActions";
import { PurchaseDetailActionsMenu } from "./components/PurchaseDetailActionsMenu";
import { PurchaseDetailPageHeader } from "./components/PurchaseDetailPageHeader";
import { PurchaseDetailSections } from "./components/PurchaseDetailSections";
import { PurchaseDetailStateHeader } from "./components/PurchaseDetailStateHeader";
import { PurchasePendingReceiptBanner } from "./components/PurchasePendingReceiptBanner";
import { PurchaseReceivePreviewModal } from "./components/PurchaseReceivePreviewModal";
import { getPurchasePrimaryAction } from "./components/purchasePrimaryAction";
import { exportPurchaseDetailPdf } from "./services/exportPurchaseDetailPdf";
import {
  buildReceiveDisassembleRequest,
  buildReceivePreview,
  findReceiveDistributionError,
  parseReceiveDistribution,
  type ReceivePreviewPurchase,
} from "./utils/buildReceivePreview";

/** Parámetro (`?receive=1`) con el que la lista pide abrir la previsualización de la recepción. */
const RECEIVE_PARAM = "receive";

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
  const { can, isLoading: isPermissionLoading, role } = usePermission();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  // Compra de la previsualización, fijada al abrir el modal: si la recepción falla
  // y el detalle se refresca, el modal sigue mostrando lo que se intentó recibir.
  const [receiveSource, setReceiveSource] = useState<ReceivePreviewPurchase | null>(null);
  // «Desarmar al recibir» marcado o desmarcado en el modal, por línea (COM-14); sin
  // entrada manda la marca guardada con el pedido.
  const [receiveDisassemble, setReceiveDisassemble] = useState<Record<string, boolean>>({});
  // Reparto tecleado en «Ajustar reparto» de cada surtido que se desarma, por línea
  // (COM-14); sin entrada la línea se abre con su receta.
  const [receiveDistribution, setReceiveDistribution] = useState<
    Record<string, PackDistributionValue>
  >({});
  // El usuario intentó recibir con un reparto que no cuadra: el motivo sube al pie del modal.
  const [receiveBlocked, setReceiveBlocked] = useState(false);
  const receiveAttempt = useRequestAttempt();
  const receivePreview = useMemo(
    () =>
      receiveSource
        ? buildReceivePreview(receiveSource, {
            disassemble: receiveDisassemble,
            distribution: parseReceiveDistribution(receiveSource, receiveDistribution),
          })
        : null,
    [receiveDisassemble, receiveDistribution, receiveSource],
  );
  const receiveDistributionError = receivePreview
    ? findReceiveDistributionError(receivePreview)
    : null;

  const purchaseData = purchase.data;
  const canReceive = can("purchases.create");
  // «Recibir mercancía…» de la lista llega con `?receive=1`: se abre la misma
  // previsualización que con el botón del aviso y nada se recibe hasta confirmar.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const receiveRequested = searchParams.get(RECEIVE_PARAM) === "1";
  // URL del detalle con el `returnTo` con el que se llegó: los enlaces que salen de
  // aquí la llevan entera, para volver a esta compra sin perder su lista de origen.
  const detailQuery = searchParams.toString();
  const detailUrl = detailQuery ? `${pathname}?${detailQuery}` : pathname;
  const [receiveRequestHandled, setReceiveRequestHandled] = useState(false);

  // La petición se atiende una sola vez, con la compra y los permisos ya cargados.
  if (receiveRequested && !receiveRequestHandled && purchaseData && !isPermissionLoading) {
    setReceiveRequestHandled(true);

    // Compra que ya no está en pedido, o usuario sin permiso: el parámetro se ignora.
    if (purchaseData.status === "pedido" && canReceive) {
      setReceiveSource(purchaseData);
    }
  }

  // Atendida, el parámetro sale de la URL (recargar o volver no reabre el modal);
  // el resto de la query, `returnTo` incluido, queda tal cual.
  useEffect(() => {
    if (!receiveRequestHandled) {
      return;
    }

    const query = window.location.search
      .slice(1)
      .split("&")
      .filter((pair) => pair !== "" && pair.split("=", 1)[0] !== RECEIVE_PARAM)
      .join("&");

    // `null` y no `history.state`: así Next refleja el cambio en `useSearchParams`.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [receiveRequestHandled]);

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

  function closeReceivePreview() {
    setReceiveSource(null);
    setReceiveDisassemble({});
    setReceiveDistribution({});
    setReceiveBlocked(false);
  }

  async function handleConfirmReceive() {
    // Un reparto que no cuadra no se envía: el control de la línea dice qué falta o sobra.
    if (receiveDistributionError) {
      setReceiveBlocked(true);
      return;
    }

    // Se envía lo que el modal muestra: las líneas que se desarman (si alguna puede).
    const disassemble = receivePreview ? buildReceiveDisassembleRequest(receivePreview) : undefined;
    // Clave de idempotencia del intento; null = ya hay un envío en vuelo (doble clic).
    const clientRequestId = receiveAttempt.begin({ disassemble: disassemble ?? null, purchaseId });

    if (!clientRequestId) {
      return;
    }

    try {
      await receivePurchase.mutateAsync({
        clientRequestId,
        ...(disassemble ? { disassemble } : {}),
        purchaseId,
      });
      receiveAttempt.succeed();
      closeReceivePreview();
    } catch (error) {
      receiveAttempt.fail(error);
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
  const pendingRef = Math.max(0, roundMoney(data.totalRef - paidRef));
  const currentRateVes = exchangeRate.data?.rateVes ?? 0;
  // "Pagar" sigue las reglas de `register_payment` y de POST /api/payments: el saldo
  // es el de bolívares (total − pagado), una compra cancelada o devuelta no admite
  // pagos, y solo paga quien tiene `payments.manage` y no es vendedor. Es la misma
  // regla que «Registrar pago» en la fila de la lista (`getPurchaseActions`).
  const { canPay } = getPurchaseActions(data, { can, role });
  // Recibir exige además un pedido: la misma condición que pinta el botón del aviso.
  const canReceiveNow = data.status === "pedido" && canReceive;
  // Los pagos individuales de la compra solo llegan a quien puede ver pagos de
  // compras (admin, contador). A los demás el BFF les manda `payments: []`: no es
  // "sin pagos", así que el historial lo dice. Pagado / Pendiente vienen de la compra.
  // Sin rol aún no se sabe cuál de los dos historiales toca: no se pinta ninguno.
  const canViewPayments = role === undefined ? undefined : canViewPurchasePayments(role);
  // Una sola acción primaria según el estado real y los permisos. «Recibir» vive en
  // el aviso fijo de «Pedido» (COM-07), justo encima de la cabecera: no se repite
  // aquí. Sin permiso para recibir o pagar se cae a la siguiente acción permitida.
  const primaryActionKind = getPurchasePrimaryAction({ canPay, canReceive: canReceiveNow });
  const primaryActions: Record<typeof primaryActionKind, PrimaryStateActionConfig | undefined> = {
    pay: {
      icon: <Wallet aria-hidden="true" className="h-4 w-4" />,
      label: "Pagar",
      onClick: () => setIsPaying(true),
    },
    pdf: {
      icon: <FileText aria-hidden="true" className="h-4 w-4" />,
      isPending: isExportingPdf,
      label: "Ver PDF",
      onClick: () => void handleExportPdf(),
      variant: "outline",
    },
    receive: undefined,
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PurchaseDetailPageHeader />

      {data.status === "pedido" ? (
        <PurchasePendingReceiptBanner
          canReceive={canReceiveNow}
          isReceiving={receivePurchase.isPending}
          onReceive={() => setReceiveSource(data)}
        />
      ) : null}

      <PurchaseDetailStateHeader
        actionsMenu={
          <PurchaseDetailActionsMenu
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
            purchaseNumber={data.purchaseNumber}
            status={data.status}
          />
        }
        currentRateVes={currentRateVes}
        paidRef={paidRef}
        paidVes={data.paidVes}
        pendingRef={pendingRef}
        primaryAction={primaryActions[primaryActionKind]}
        purchaseNumber={data.purchaseNumber}
        refRateVes={data.refRateVes}
        status={data.status}
        totalRef={data.totalRef}
        totalVes={data.totalVes}
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

      <PurchaseRepriceNotice purchaseId={data.id} />

      <PurchaseDetailSections
        canViewPayments={canViewPayments}
        detailUrl={detailUrl}
        paidRef={paidRef}
        pendingRef={pendingRef}
        purchase={data}
      />

      {/* Sigue montado aunque la compra ya no esté en pedido: el error de una
          recepción repetida tiene que seguir a la vista hasta que se cierre. */}
      {receivePreview ? (
        <PurchaseReceivePreviewModal
          distributionValues={receiveDistribution}
          error={
            receiveBlocked && receiveDistributionError
              ? receiveDistributionError
              : receivePurchase.error instanceof Error
                ? describePurchaseRequestError(receivePurchase.error)
                : null
          }
          isPending={receivePurchase.isPending}
          lines={receivePreview}
          onConfirm={handleConfirmReceive}
          onDisassembleChange={(purchaseItemId, disassemble) =>
            setReceiveDisassemble((current) => ({ ...current, [purchaseItemId]: disassemble }))
          }
          onDistributionChange={(purchaseItemId, value) =>
            setReceiveDistribution((current) => ({ ...current, [purchaseItemId]: value }))
          }
          onOpenChange={(open) => {
            if (!open) {
              closeReceivePreview();
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
