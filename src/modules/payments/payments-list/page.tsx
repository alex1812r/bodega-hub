"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import { RegisterPaymentModal } from "../components/RegisterPaymentModal";
import { PaymentCancelConfirmModal } from "../components/PaymentCancelConfirmModal";
import {
  type PaymentListItem,
  type PaymentsFilters,
  useCancelPayment,
  usePayments,
} from "../hooks/usePayments";
import { PaymentsContactCell } from "./components/PaymentsContactCell";
import {
  formatPaymentIdDisplay,
  PaymentsCopyableCodeCell,
} from "./components/PaymentsCopyableCodeCell";
import { PaymentsCurrencyBadge } from "./components/PaymentsCurrencyBadge";
import { PaymentsDirectionBadge } from "./components/PaymentsDirectionBadge";
import { PaymentsExportActions } from "./components/PaymentsExportActions";
import { PaymentsListFilters } from "./components/PaymentsListFilters";
import { getPaymentReference } from "./utils/paymentReference";

type PaymentsListPageProps = {
  initialFilters?: PaymentsFilters;
};

const methodLabel = {
  efectivo_usd: "Efectivo USD",
  efectivo_ves: "Efectivo VES",
  pago_movil: "Pago móvil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
} as const;

const paymentIdCellClass = "min-w-0 w-[5.75rem] max-w-[5.75rem] overflow-hidden";
const paymentIdHeaderClass = "w-[5.75rem] max-w-[5.75rem]";
const referenceCellClass = "min-w-0 w-[7rem] max-w-[7rem] overflow-hidden";
const referenceHeaderClass = "w-[7rem] max-w-[7rem]";

const columns: DataTableColumn<PaymentListItem>[] = [
  {
    cellClassName: paymentIdCellClass,
    className: paymentIdHeaderClass,
    header: "ID Pago",
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
    cellClassName: referenceCellClass,
    className: referenceHeaderClass,
    header: "Referencia",
    key: "reference",
    render: (payment) => {
      const reference = getPaymentReference(payment);

      return (
        <PaymentsCopyableCodeCell
          copyValue={reference.copyValue}
          displayValue={reference.displayValue}
          fullValue={reference.fullValue}
          href={reference.href}
          maxWidthClass="w-full max-w-none"
        />
      );
    },
    visibility: "md",
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
    render: (payment) => methodLabel[payment.method],
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

export function PaymentsListPage({ initialFilters = {} }: PaymentsListPageProps) {
  const [filters, setFilters] = useState<PaymentsFilters>(initialFilters);
  const [paymentToCancel, setPaymentToCancel] = useState<string | null>(null);
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.contactId,
    filters.direction,
    filters.purchaseId,
    filters.saleId,
  ]);
  const payments = usePayments({ ...filters, limit, skip });
  const cancelPayment = useCancelPayment();
  const paymentItems = getPaginatedItems(payments.data);
  const totalPayments = payments.data?.total ?? 0;

  function handleFilterChange(patch: Partial<PaymentsFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  async function handleCancelPayment() {
    if (!paymentToCancel) {
      return;
    }

    await cancelPayment.mutateAsync(paymentToCancel);
    setPaymentToCancel(null);
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <PaymentsExportActions exportFilters={filters} />
            <Can permission="payments.manage">
              <RegisterPaymentModal
                purchaseId={filters.purchaseId}
                saleId={filters.saleId}
                trigger={
                  <Button className="w-full gap-2 shadow-sm sm:w-auto" size="sm">
                    <Plus aria-hidden className="size-5" />
                    Registrar pago
                  </Button>
                }
              />
            </Can>
          </div>
        }
        description="Gestione las entradas y salidas de fondos de la empresa."
        layout="sections"
        title="Pagos"
      >
        <PaymentsListFilters filters={filters} onChange={handleFilterChange} />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(payment) => [
              { href: `/payments/${payment.id}`, label: "Ver comprobante" },
              {
                disabled:
                  cancelPayment.isPending ||
                  payment.status === "anulado",
                label: "Anular",
                onSelect: () => setPaymentToCancel(payment.id),
                variant: "danger",
              },
            ]}
            cardSubtitle={(payment) => {
              const reference = getPaymentReference(payment);
              return reference.displayValue;
            }}
            cardTitle={(payment) => formatPaymentIdDisplay(payment.id)}
            columns={columns}
            data={paymentItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="payments.manage">
                    <RegisterPaymentModal
                      purchaseId={filters.purchaseId}
                      saleId={filters.saleId}
                      trigger={
                        <Button className="gap-2" size="sm">
                          <Plus aria-hidden className="size-5" />
                          Registrar pago
                        </Button>
                      }
                    />
                  </Can>
                }
                description="Registra un pago o ajusta los filtros para ver otros resultados."
                title="No hay pagos para mostrar"
              />
            }
            error={payments.error ?? cancelPayment.error}
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

      <PaymentCancelConfirmModal
        isConfirming={cancelPayment.isPending}
        onConfirm={() => void handleCancelPayment()}
        onOpenChange={(open) => {
          if (!open) {
            setPaymentToCancel(null);
          }
        }}
        open={paymentToCancel !== null}
        paymentId={paymentToCancel ?? ""}
      />
    </div>
  );
}
