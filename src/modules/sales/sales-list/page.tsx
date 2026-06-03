"use client";

import Link from "next/link";
import { useState } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
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

import { useContacts } from "@/modules/contacts/hooks/useContacts";
import {
  type SaleListItem,
  type SalesFilters,
  useCancelSale,
  useReturnSale,
  useSales,
} from "../hooks/useSales";

const statusVariant = {
  borrador: "default",
  cancelada: "danger",
  devuelta: "warning",
  pagada: "success",
  pendiente_pago: "warning",
} as const;

const statusLabel = {
  borrador: "borrador",
  cancelada: "cancelada",
  devuelta: "devuelta",
  pagada: "pagada",
  pendiente_pago: "pendiente pago",
} as const;

const columns: DataTableColumn<SaleListItem>[] = [
  {
    header: "Venta",
    hideInCard: true,
    key: "id",
    render: (sale) => sale.invoiceNumber,
  },
  {
    header: "Cliente",
    key: "customer",
    render: (sale) => sale.customer?.name ?? sale.customerId,
    visibility: "md",
  },
  {
    header: "Fecha",
    key: "date",
    render: (sale) => formatDate(sale.createdAt),
    visibility: "md",
  },
  {
    header: "Total ref",
    key: "totalRef",
    render: (sale) => formatRef(sale.totalRef),
  },
  {
    header: "Total VES",
    key: "totalVes",
    render: (sale) => formatVes(sale.totalVes),
    visibility: "lg",
  },
  {
    header: "Estado",
    key: "status",
    render: (sale) => (
      <Badge variant={statusVariant[sale.status]}>{statusLabel[sale.status]}</Badge>
    ),
  },
];

export function SalesListPage() {
  const [filters, setFilters] = useState<SalesFilters>({});
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.customerId,
    filters.status,
    filters.from,
    filters.to,
  ]);
  const sales = useSales({ ...filters, limit, skip });
  const contacts = useContacts();
  const cancelSale = useCancelSale();
  const returnSale = useReturnSale();
  const customers = getPaginatedItems(contacts.data).filter(
    (contact) => contact.type === "cliente" || contact.type === "ambos",
  );

  async function handleCancelSale(saleId: string) {
    await cancelSale.mutateAsync(saleId);
  }

  async function handleReturnSale(saleId: string) {
    await returnSale.mutateAsync(saleId);
  }

  return (
    <EntityListPage
      actions={
        <Can permission="sales.create">
          <Button asChild size="sm">
            <Link href="/sales/create">Nueva venta</Link>
          </Button>
        </Can>
      }
      description={`Listado de ventas ${getConnectedToApiPhrase()} con filtros por cliente, estado y fechas.`}
      title="Ventas"
    >
      <FilterPanel>
        <SelectField
          label="Cliente"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              customerId: event.target.value || undefined,
            }))
          }
          options={customers.map((contact) => ({
            label: contact.name,
            value: contact.id,
          }))}
          placeholder="Todos"
          value={filters.customerId ?? ""}
        />
        <SelectField
          label="Estado"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.value || undefined,
            }))
          }
          options={[
            { label: "Borrador", value: "borrador" },
            { label: "Pendiente pago", value: "pendiente_pago" },
            { label: "Pagada", value: "pagada" },
            { label: "Cancelada", value: "cancelada" },
            { label: "Devuelta", value: "devuelta" },
          ]}
          placeholder="Todos"
          value={filters.status ?? ""}
        />
        <Input
          label="Desde"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              from: event.target.value || undefined,
            }))
          }
          type="date"
          value={filters.from ?? ""}
        />
        <Input
          label="Hasta"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              to: event.target.value || undefined,
            }))
          }
          type="date"
          value={filters.to ?? ""}
        />
      </FilterPanel>

      <DataTable
        cardSubtitle={(sale) => sale.customer?.name ?? sale.customerId}
        cardTitle={(sale) => sale.invoiceNumber}
        actions={(sale) => [
          { href: `/sales/${sale.id}`, label: "Ver detalle" },
          { href: `/payments?saleId=${sale.id}`, label: "Registrar pago" },
          { href: `/sales/${sale.id}`, label: "Ver recibo" },
          {
            label: "Anular",
            onSelect: () => void handleCancelSale(sale.id),
            disabled: cancelSale.isPending || sale.status === "cancelada",
            variant: "danger",
          },
          {
            label: "Devolver",
            onSelect: () => void handleReturnSale(sale.id),
            disabled: returnSale.isPending || sale.status === "devuelta",
          },
        ]}
        columns={columns}
        data={getPaginatedItems(sales.data)}
        emptyState={
          <EmptyState
            action={
              <Button asChild size="sm">
                <Link href="/sales/create">Registrar venta</Link>
              </Button>
            }
            description="Crea una venta o ajusta los filtros para ver otros resultados."
            title="No hay ventas para mostrar"
          />
        }
        error={sales.error ?? cancelSale.error ?? returnSale.error}
        getRowId={(sale) => sale.id}
        isFetching={sales.isFetching}
        isLoading={sales.isLoading}
        onRetry={() => void sales.refetch()}
      />
      <ResponsivePagination
        isDisabled={sales.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={sales.data?.skip ?? skip}
        total={sales.data?.total ?? 0}
      />
    </EntityListPage>
  );
}
