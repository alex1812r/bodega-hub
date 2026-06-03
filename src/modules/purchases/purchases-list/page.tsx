"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import { Can } from "@/shared/auth/Can";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import {
  type PurchaseListRow,
  type PurchasesFilters,
  useCancelPurchase,
  usePurchases,
  useReceivePurchase,
  useReturnPurchase,
} from "../hooks/usePurchases";

const statusVariant = {
  cancelado: "danger",
  devuelto: "warning",
  pedido: "info",
  recibido: "success",
} as const;

const columns: DataTableColumn<PurchaseListRow>[] = [
  {
    header: "Compra",
    hideInCard: true,
    key: "id",
    render: (purchase) => purchase.purchaseNumber,
  },
  {
    header: "Proveedor",
    key: "supplier",
    render: (purchase) => purchase.supplier?.name ?? purchase.supplierId,
    visibility: "md",
  },
  {
    header: "Fecha",
    key: "date",
    render: (purchase) => formatDate(purchase.createdAt),
    visibility: "md",
  },
  {
    align: "right",
    header: "Items",
    key: "itemsCount",
    render: (purchase) => purchase.itemsCount,
    visibility: "lg",
  },
  {
    align: "right",
    header: "Total ref",
    key: "totalRef",
    render: (purchase) => formatRef(purchase.totalRef),
  },
  {
    align: "right",
    header: "Total VES",
    key: "totalVes",
    render: (purchase) => formatVes(purchase.totalVes),
    visibility: "lg",
  },
  {
    header: "Estado",
    key: "status",
    render: (purchase) => (
      <Badge variant={statusVariant[purchase.status]}>{purchase.status}</Badge>
    ),
  },
];

export function PurchasesListPage() {
  const [filters, setFilters] = useState<PurchasesFilters>({});
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.supplierId,
    filters.status,
    filters.from,
    filters.to,
  ]);
  const purchases = usePurchases({ ...filters, limit, skip });
  const suppliersQuery = useContacts();
  const cancelPurchase = useCancelPurchase();
  const receivePurchase = useReceivePurchase();
  const returnPurchase = useReturnPurchase();
  const suppliers = useMemo(
    () =>
      getPaginatedItems(suppliersQuery.data).filter(
        (contact) => contact.type === "proveedor" || contact.type === "ambos",
      ),
    [suppliersQuery.data],
  );

  return (
    <EntityListPage
      actions={
        <Can permission="purchases.create">
          <Button asChild size="sm">
            <Link href="/purchases/create">Registrar compra</Link>
          </Button>
        </Can>
      }
      description={`Listado de compras ${getConnectedToApiPhrase()} con proveedor, estado de recepcion y totales.`}
      title="Compras"
    >
      <FilterPanel>
        <SelectField
          label="Proveedor"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              supplierId: event.target.value || undefined,
            }))
          }
          options={suppliers.map((supplier) => ({
            label: supplier.name,
            value: supplier.id,
          }))}
          placeholder="Todos"
          value={filters.supplierId ?? ""}
        />
        <SelectField
          label="Estado"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: (event.target.value as PurchaseStatus) || undefined,
            }))
          }
          options={[
            { label: "Pedido", value: "pedido" },
            { label: "Recibido", value: "recibido" },
            { label: "Cancelado", value: "cancelado" },
            { label: "Devuelto", value: "devuelto" },
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
        cardSubtitle={(purchase) => purchase.supplier?.name ?? purchase.supplierId}
        cardTitle={(purchase) => purchase.purchaseNumber}
        actions={(purchase) => [
          { href: `/purchases/${purchase.id}`, label: "Ver detalle" },
          { href: `/payments?purchaseId=${purchase.id}`, label: "Registrar pago" },
          ...(purchase.status === "pedido"
            ? [
                {
                  label: "Recibir pedido",
                  onSelect: () => void receivePurchase.mutateAsync(purchase.id),
                  disabled: receivePurchase.isPending,
                },
              ]
            : []),
          {
            label: "Cancelar",
            onSelect: () => {
              void cancelPurchase.mutateAsync(purchase.id);
            },
            variant: "danger",
          },
          {
            label: "Devolver",
            onSelect: () => {
              void returnPurchase.mutateAsync(purchase.id);
            },
            variant: "danger",
          },
        ]}
        columns={columns}
        data={getPaginatedItems(purchases.data)}
        error={
          purchases.error ??
          cancelPurchase.error ??
          receivePurchase.error ??
          returnPurchase.error
        }
        getRowId={(purchase) => purchase.id}
        isFetching={purchases.isFetching}
        isLoading={purchases.isLoading}
        onRetry={() => void purchases.refetch()}
      />
      <ResponsivePagination
        isDisabled={purchases.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={purchases.data?.skip ?? skip}
        total={purchases.data?.total ?? 0}
      />
    </EntityListPage>
  );
}
