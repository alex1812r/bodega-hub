"use client";

import { useState } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Badge } from "@/shared/components/Badge";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import { Can } from "@/shared/auth/Can";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import { RegisterPaymentModal } from "../components/RegisterPaymentModal";
import {
  type PaymentListItem,
  type PaymentsFilters,
  usePayments,
} from "../hooks/usePayments";

type PaymentsListPageProps = {
  initialFilters?: PaymentsFilters;
};

const methodLabel = {
  efectivo_usd: "Efectivo USD",
  efectivo_ves: "Efectivo VES",
  pago_movil: "Pago movil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
} as const;

const directionLabel = {
  entrada: "Entrada",
  salida: "Salida",
} as const;

const columns: DataTableColumn<PaymentListItem>[] = [
  {
    header: "Pago",
    hideInCard: true,
    key: "id",
    render: (payment) => payment.id,
  },
  {
    header: "Contacto",
    key: "contact",
    render: (payment) => payment.contact?.name ?? payment.contactId,
    visibility: "md",
  },
  {
    header: "Documento",
    key: "document",
    render: (payment) => payment.saleId ?? payment.purchaseId ?? "Sin contexto",
    visibility: "md",
  },
  {
    header: "Fecha",
    key: "createdAt",
    render: (payment) => formatDate(payment.createdAt),
    visibility: "md",
  },
  {
    header: "Metodo",
    key: "method",
    render: (payment) => methodLabel[payment.method],
  },
  {
    header: "Moneda",
    key: "currency",
    render: (payment) => (
      <Badge variant="info">
        {payment.currency ?? (payment.method === "efectivo_usd" ? "USD" : "VES")}
      </Badge>
    ),
    visibility: "lg",
  },
  {
    header: "Monto ref",
    key: "amountRef",
    render: (payment) => formatRef(payment.amountRef),
  },
  {
    header: "Monto VES",
    key: "amountVes",
    render: (payment) => formatVes(payment.amountVes),
    visibility: "lg",
  },
  {
    header: "Tipo",
    key: "direction",
    render: (payment) => (
      <Badge variant={payment.direction === "entrada" ? "success" : "warning"}>
        {directionLabel[payment.direction]}
      </Badge>
    ),
  },
];

export function PaymentsListPage({ initialFilters = {} }: PaymentsListPageProps) {
  const [filters, setFilters] = useState<PaymentsFilters>(initialFilters);
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.contactId,
    filters.direction,
    filters.purchaseId,
    filters.saleId,
  ]);
  const payments = usePayments({ ...filters, limit, skip });

  return (
    <EntityListPage
      actions={
        <Can permission="payments.manage">
          <RegisterPaymentModal
            purchaseId={filters.purchaseId}
            saleId={filters.saleId}
          />
        </Can>
      }
      description={`Listado de pagos ${getConnectedToApiPhrase()} con filtros por documento, contacto y tipo.`}
      title="Pagos"
    >
      <FilterPanel>
        <Input
          label="Venta"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              saleId: event.target.value || undefined,
            }))
          }
          placeholder="sale-002"
          value={filters.saleId ?? ""}
        />
        <Input
          label="Compra"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              purchaseId: event.target.value || undefined,
            }))
          }
          placeholder="purchase-001"
          value={filters.purchaseId ?? ""}
        />
        <Input
          label="Contacto"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              contactId: event.target.value || undefined,
            }))
          }
          placeholder="cont-customer"
          value={filters.contactId ?? ""}
        />
        <SelectField
          label="Tipo"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              direction: event.target.value || undefined,
            }))
          }
          options={[
            { label: "Entrada", value: "entrada" },
            { label: "Salida", value: "salida" },
          ]}
          placeholder="Todos"
          value={filters.direction ?? ""}
        />
      </FilterPanel>

      <DataTable
        cardSubtitle={(payment) => payment.contact?.name ?? payment.contactId}
        cardTitle={(payment) => payment.id}
        actions={(payment) => [
          { href: `/payments/${payment.id}`, label: "Ver comprobante" },
          {
            disabled: true,
            label: "Anular (pendiente)",
            variant: "danger",
          },
        ]}
        columns={columns}
        data={getPaginatedItems(payments.data)}
        emptyState={
          <EmptyState
            action={
              <RegisterPaymentModal
                purchaseId={filters.purchaseId}
                saleId={filters.saleId}
              />
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
      />
      <ResponsivePagination
        isDisabled={payments.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={payments.data?.skip ?? skip}
        total={payments.data?.total ?? 0}
      />
    </EntityListPage>
  );
}
