"use client";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { Can } from "@/shared/auth/Can";
import { getPaginatedItems } from "@/lib/api/pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSection } from "@/shared/components/DetailSection";
import { PageHeader } from "@/shared/components/PageHeader";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import type { PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import {
  type ContactActivityRow,
  ContactActivityTable,
} from "./components/ContactActivityTable";
import { ContactFormModal } from "./components/ContactFormModal";
import { ContactProfileCard } from "./components/ContactProfileCard";
import {
  type ContactActivityApiRow,
  type ContactInput,
  useContact,
  useContactActivity,
  useContactPayments,
  useContactPurchases,
  useContactSales,
  useUpdateContact,
} from "../hooks/useContacts";

type ContactDetailsPageProps = {
  contactId?: string;
};

const activityTypeLabel = {
  payment: "pago",
  purchase: "compra",
  sale: "venta",
} as const;

const salesColumns: DataTableColumn<SaleMock>[] = [
  { header: "Factura", key: "invoiceNumber", render: (row) => row.invoiceNumber },
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
];

const purchasesColumns: DataTableColumn<PurchaseMock>[] = [
  { header: "Compra", key: "purchaseNumber", render: (row) => row.purchaseNumber },
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
];

const paymentsColumns: DataTableColumn<PaymentMock>[] = [
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  { header: "Metodo", key: "method", render: (row) => row.method },
  { align: "right", header: "Monto VES", key: "amountVes", render: (row) => formatVes(row.amountVes) },
];

function mapActivityRows(rows: ContactActivityApiRow[]): ContactActivityRow[] {
  return [...rows]
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .map((row) => ({
      amountVes: row.amountVes,
      date: formatDate(row.createdAt),
      id: `${row.type}-${row.id}`,
      reference: row.id,
      type: activityTypeLabel[row.type],
    }));
}

export function ContactDetailsPage({ contactId = "cont-customer" }: ContactDetailsPageProps) {
  const contact = useContact(contactId);
  const activity = useContactActivity(contactId);
  const sales = useContactSales(contactId);
  const purchases = useContactPurchases(contactId);
  const payments = useContactPayments(contactId);
  const updateContact = useUpdateContact(contactId);

  async function handleUpdateContact(input: ContactInput) {
    await updateContact.mutateAsync(input);
  }

  if (contact.isLoading) {
    return (
      <LoadingState
        description="Estamos consultando perfil y actividad reciente."
        title="Cargando contacto"
      />
    );
  }

  if (contact.error || !contact.data) {
    return (
      <ErrorState
        description={
          contact.error instanceof Error
            ? contact.error.message
            : "No pudimos cargar el detalle del contacto."
        }
        onRetry={() => void contact.refetch()}
        title="No pudimos cargar el contacto"
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <Can permission="contacts.manage">
            <ContactFormModal
              contact={contact.data}
              errorMessage={updateContact.error?.message}
              isSubmitting={updateContact.isPending}
              mode="edit"
              onSubmit={handleUpdateContact}
            />
          </Can>
        }
        badge={<p className="text-sm font-medium text-blue-600">Contacto</p>}
        description={`Perfil de cliente/proveedor ${getConnectedToApiPhrase()}.`}
        title={contact.data.name}
      />

      <ContactProfileCard contact={contact.data} />
      <ContactActivityTable
        error={activity.error}
        isFetching={activity.isFetching}
        isLoading={activity.isLoading}
        onRetry={() => void activity.refetch()}
        rows={mapActivityRows(getPaginatedItems(activity.data))}
      />

      <DetailSection description="Ventas asociadas al contacto." title="Ventas">
        <DataTable
          columns={salesColumns}
          data={getPaginatedItems(sales.data)}
          error={sales.error}
          getRowId={(row) => row.id}
          isFetching={sales.isFetching}
          isLoading={sales.isLoading}
          onRetry={() => void sales.refetch()}
        />
      </DetailSection>

      <DetailSection description="Compras asociadas al contacto." title="Compras">
        <DataTable
          columns={purchasesColumns}
          data={getPaginatedItems(purchases.data)}
          error={purchases.error}
          getRowId={(row) => row.id}
          isFetching={purchases.isFetching}
          isLoading={purchases.isLoading}
          onRetry={() => void purchases.refetch()}
        />
      </DetailSection>

      <DetailSection description="Pagos asociados al contacto." title="Pagos">
        <DataTable
          columns={paymentsColumns}
          data={getPaginatedItems(payments.data)}
          error={payments.error}
          getRowId={(row) => row.id}
          isFetching={payments.isFetching}
          isLoading={payments.isLoading}
          onRetry={() => void payments.refetch()}
        />
      </DetailSection>
    </div>
  );
}
