"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { ResponsivePagination, useUrlPaginationState } from "@/shared/components/Pagination";
import { useUrlListState, withUrlListBoundary } from "@/shared/hooks/useUrlListState";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import { PaymentDocumentPicker } from "../components/PaymentDocumentPicker";
import { RegisterPaymentModal } from "../components/RegisterPaymentModal";
import { PaymentCancelConfirmModal } from "../components/PaymentCancelConfirmModal";
import {
  type PaymentListItem,
  useCancelPayment,
  usePayments,
} from "../hooks/usePayments";
import { paymentMethodLabels } from "../payment-details/utils/paymentDetailLabels";
import { PaymentsContactCell } from "./components/PaymentsContactCell";
import {
  formatPaymentIdDisplay,
  PaymentsCopyableCodeCell,
} from "./components/PaymentsCopyableCodeCell";
import { PaymentsCurrencyBadge } from "./components/PaymentsCurrencyBadge";
import { PaymentsDirectionBadge } from "./components/PaymentsDirectionBadge";
import { PaymentsDocumentCell } from "./components/PaymentsDocumentCell";
import { PaymentsExportActions } from "./components/PaymentsExportActions";
import { PaymentsListFilters } from "./components/PaymentsListFilters";
import { usePaymentsFilterChips } from "./hooks/usePaymentsFilterChips";
import {
  CLEARED_PAYMENTS_FILTERS,
  hasActivePaymentsFilters,
  paymentsListSchema,
  toPaymentsFilters,
} from "./utils/paymentsListState";

/** Documento que se está pagando: lo fija el enlace profundo o el buscador. */
type PayingDocument = { id: string; type: "purchase" | "sale" };

const paymentIdCellClass = "min-w-0 w-[5.75rem] max-w-[5.75rem] overflow-hidden";
const paymentIdHeaderClass = "w-[5.75rem] max-w-[5.75rem]";
const documentCellClass = "min-w-0 w-[7rem] max-w-[7rem] overflow-hidden";
const documentHeaderClass = "w-[7rem] max-w-[7rem]";

/** `listHref`: URL exacta de la lista, que viaja como `returnTo` al detalle del documento. */
function buildColumns(listHref: string): DataTableColumn<PaymentListItem>[] {
  return [
    {
      cellClassName: paymentIdCellClass,
      className: paymentIdHeaderClass,
      header: "Comprobante",
      hideInCard: true,
      key: "id",
      render: (payment) => (
        <PaymentsCopyableCodeCell
          copyValue={payment.id}
          displayValue={formatPaymentIdDisplay(payment.id)}
          maxWidthClass="max-w-[5.75rem]"
        />
      ),
    },
    {
      header: "Contacto",
      key: "contact",
      render: (payment) => (
        <PaymentsContactCell
          name={payment.contact?.name ?? payment.contactId}
          taxId={payment.contact?.taxId}
        />
      ),
    },
    {
      cellClassName: documentCellClass,
      className: documentHeaderClass,
      header: "Documento",
      key: "document",
      render: (payment) => <PaymentsDocumentCell listHref={listHref} payment={payment} />,
    },
    {
      cellClassName: "text-on-surface-variant whitespace-nowrap",
      header: "Fecha",
      key: "createdAt",
      render: (payment) => formatDate(payment.createdAt),
      visibility: "md",
    },
    {
      header: "Método",
      key: "method",
      render: (payment) => paymentMethodLabels[payment.method],
    },
    {
      align: "center",
      header: "Moneda",
      key: "currency",
      render: (payment) => (
        <div className="flex justify-center">
          <PaymentsCurrencyBadge
            currency={
              payment.currency ?? (payment.method === "efectivo_usd" ? "USD" : "VES")
            }
          />
        </div>
      ),
      visibility: "lg",
    },
    {
      align: "right",
      cellClassName: "font-medium tabular-nums",
      header: "Monto REF",
      key: "amountRef",
      render: (payment) => (
        <span className={payment.status === "anulado" ? "text-muted-foreground line-through" : undefined}>
          {formatRefUsd(payment.amountRef)}
        </span>
      ),
    },
    {
      align: "right",
      cellClassName: "tabular-nums text-on-surface-variant",
      header: "Monto VES",
      key: "amountVes",
      render: (payment) => formatVesBs(payment.amountVes),
      visibility: "lg",
    },
    {
      header: "Tipo",
      key: "direction",
      render: (payment) => <PaymentsDirectionBadge direction={payment.direction} />,
    },
  ];
}

function PaymentsList() {
  const { can, role } = usePermission();
  const salePaymentsOnly = role ? !canViewPurchasePayments(role) : false;
  const canRegisterPayment = can("payments.manage") || can("sales.create");
  // Filtros, página y tamaño viven en la URL: recarga, "atrás" y volver de un detalle los conservan.
  const list = useUrlListState(paymentsListSchema);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  const [paymentToCancel, setPaymentToCancel] = useState<string | null>(null);
  const effectiveFilters = toPaymentsFilters(list.state, salePaymentsOnly);
  const payments = usePayments({ ...effectiveFilters, limit, skip });
  const cancelPayment = useCancelPayment();
  const paymentItems = getPaginatedItems(payments.data);
  const totalPayments = payments.data?.total ?? 0;
  const filterChips = usePaymentsFilterChips(effectiveFilters, payments.isSuccess);
  const columns = useMemo(() => buildColumns(list.href), [list.href]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [payingDocument, setPayingDocument] = useState<PayingDocument | null>(null);
  const { purchaseId: linkedPurchaseId, saleId: linkedSaleId } = effectiveFilters;

  function handleRegisterPayment() {
    // Enlace profundo (`?saleId=` o `?purchaseId=`, uno solo): el documento ya está elegido.
    if (linkedSaleId && !linkedPurchaseId) {
      setPayingDocument({ id: linkedSaleId, type: "sale" });
    } else if (linkedPurchaseId && !linkedSaleId) {
      setPayingDocument({ id: linkedPurchaseId, type: "purchase" });
    } else {
      setIsPickerOpen(true);
    }
  }

  function handleCancelPayment() {
    if (!paymentToCancel) {
      return;
    }

    // `mutate` no rechaza: si falla, el modal sigue abierto y muestra `cancelPayment.error`.
    cancelPayment.mutate(paymentToCancel, {
      onSuccess: () => setPaymentToCancel(null),
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <PaymentsExportActions exportFilters={effectiveFilters} />
            {canRegisterPayment ? (
              <Button
                className="w-full gap-2 shadow-sm sm:w-auto"
                onClick={handleRegisterPayment}
                size="sm"
                type="button"
              >
                <Plus aria-hidden className="size-5" />
                Registrar pago
              </Button>
            ) : null}
          </div>
        }
        description={
          salePaymentsOnly
            ? "Gestione los cobros asociados a ventas."
            : "Gestione las entradas y salidas de fondos de la empresa."
        }
        layout="sections"
        title="Pagos"
      >
        <PaymentsListFilters
          chips={filterChips}
          hasActiveFilters={hasActivePaymentsFilters(list.state, salePaymentsOnly)}
          onChange={list.setState}
          onClear={() => list.setState(CLEARED_PAYMENTS_FILTERS)}
          onRemoveChip={(key) => list.setField(key, "")}
          salePaymentsOnly={salePaymentsOnly}
          state={list.state}
        />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(payment) => [
              { href: `/payments/${payment.id}`, label: "Ver comprobante" },
              ...(can("payments.manage")
                ? [
                    {
                      disabled:
                        cancelPayment.isPending ||
                        payment.status === "anulado",
                      label: "Anular",
                      onSelect: () => setPaymentToCancel(payment.id),
                      variant: "danger" as const,
                    },
                  ]
                : []),
            ]}
            cardTitle={(payment) => formatPaymentIdDisplay(payment.id)}
            columns={columns}
            data={paymentItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  canRegisterPayment ? (
                    <Button
                      className="gap-2"
                      onClick={handleRegisterPayment}
                      size="sm"
                      type="button"
                    >
                      <Plus aria-hidden className="size-5" />
                      Registrar pago
                    </Button>
                  ) : undefined
                }
                description="Registra un pago o ajusta los filtros para ver otros resultados."
                title="No hay pagos para mostrar"
              />
            }
            error={payments.error}
            getRowId={(payment) => payment.id}
            isFetching={payments.isFetching}
            isLoading={payments.isLoading}
            onRetry={() => void payments.refetch()}
            variant="stitch-purchases"
          />

          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="pagos"
              isDisabled={payments.isFetching}
              limit={limit}
              onLimitChange={setLimit}
              onSkipChange={setSkip}
              skip={payments.data?.skip ?? skip}
              total={totalPayments}
              variant="stitch"
            />
          </div>
        </div>
      </EntityListPage>

      {canRegisterPayment ? (
        <>
          <PaymentDocumentPicker
            canPayPurchases={can("payments.manage") && !salePaymentsOnly}
            onOpenChange={setIsPickerOpen}
            onSelect={(document) => {
              setIsPickerOpen(false);
              setPayingDocument({ id: document.id, type: document.type });
            }}
            open={isPickerOpen}
          />
          {/* Cerrar el modal, con o sin pago, cierra todo: el buscador no se reabre. */}
          <RegisterPaymentModal
            onOpenChange={(open) => {
              if (!open) {
                setPayingDocument(null);
              }
            }}
            open={payingDocument !== null}
            purchaseId={payingDocument?.type === "purchase" ? payingDocument.id : undefined}
            saleId={payingDocument?.type === "sale" ? payingDocument.id : undefined}
          />
        </>
      ) : null}

      <PaymentCancelConfirmModal
        error={cancelPayment.error?.message}
        isConfirming={cancelPayment.isPending}
        onConfirm={handleCancelPayment}
        onOpenChange={(open) => {
          if (!open) {
            setPaymentToCancel(null);
            // El rechazo era de este pago: que no reaparezca al abrir otro.
            cancelPayment.reset();
          }
        }}
        open={paymentToCancel !== null}
        paymentId={paymentToCancel ?? ""}
      />
    </div>
  );
}

export const PaymentsListPage = withUrlListBoundary(PaymentsList);
