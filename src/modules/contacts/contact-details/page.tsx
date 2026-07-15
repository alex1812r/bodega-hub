"use client";

import { useMemo } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { Can } from "@/shared/auth/Can";
import { getPaginatedItems } from "@/lib/api/pagination";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import type { PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";
import { formatDate } from "@/shared/utils/date";

import { buildActivityTimelineItems } from "./components/ContactActivityTimeline";
import { ContactDetailActivityTabs } from "./components/ContactDetailActivityTabs";
import { ContactDetailMetrics } from "./components/ContactDetailMetrics";
import {
  ContactDetailEditButton,
  ContactDetailPageHeader,
} from "./components/ContactDetailPageHeader";
import { ContactFormModal } from "./components/ContactFormModal";
import { ContactProfileCard } from "./components/ContactProfileCard";
import { computeContactDetailMetrics } from "./utils/computeContactDetailMetrics";
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

function mapActivityRows(rows: ContactActivityApiRow[]) {
  return [...rows]
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .map((row) => ({
      amountVes: row.amountVes,
      createdAt: row.createdAt,
      id: `${row.type}-${row.id}`,
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

  const salesRows = getPaginatedItems(sales.data) as SaleMock[];
  const purchaseRows = getPaginatedItems(purchases.data) as PurchaseMock[];
  const paymentRows = getPaginatedItems(payments.data) as PaymentMock[];

  const metrics = useMemo(
    () =>
      contact.data
        ? computeContactDetailMetrics(contact.data.type, salesRows, purchaseRows, paymentRows)
        : null,
    [contact.data, paymentRows, purchaseRows, salesRows],
  );

  const activityItems = useMemo(
    () =>
      buildActivityTimelineItems(
        mapActivityRows(getPaginatedItems(activity.data)),
        (isoDate) => formatDate(isoDate),
      ),
    [activity.data],
  );

  async function handleUpdateContact(input: ContactInput) {
    await updateContact.mutateAsync(input);
  }

  if (contact.isLoading) {
    return <DetailSkeleton itemsPerSection={4} />;
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

  const data = contact.data;
  const isSaving = updateContact.isPending;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <ContactDetailPageHeader
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <PageBackButton href="/contacts" size="sm" />
            <Can permission="contacts.manage">
              <ContactFormModal
                contact={data}
                errorMessage={updateContact.error?.message}
                isSubmitting={isSaving}
                mode="edit"
                onSubmit={handleUpdateContact}
                trigger={
                  <ContactDetailEditButton disabled={isSaving}>
                    {isSaving ? "Guardando..." : "Editar"}
                  </ContactDetailEditButton>
                }
              />
            </Can>
          </div>
        }
        isActive={data.isActive}
        name={data.name}
      />

      {getConnectedToApiPhrase() ? (
        <p className="sr-only">{getConnectedToApiPhrase()}</p>
      ) : null}

      {updateContact.error ? (
        <ErrorState
          description={
            updateContact.error instanceof Error
              ? updateContact.error.message
              : "No se pudo guardar el cambio."
          }
          title="No pudimos actualizar el contacto"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ContactProfileCard className="lg:col-span-1" contact={data} />
        {metrics ? (
          <div className="lg:col-span-2">
            <ContactDetailMetrics contactType={data.type} metrics={metrics} />
          </div>
        ) : null}
      </div>

      <ContactDetailActivityTabs
        activity={{
          error: activity.error,
          isFetching: activity.isFetching,
          isLoading: activity.isLoading,
          items: activityItems,
          onRetry: () => void activity.refetch(),
        }}
        contactId={contactId}
        contactName={data.name}
        contactType={data.type}
        payments={{
          data: paymentRows,
          error: payments.error,
          isFetching: payments.isFetching,
          isLoading: payments.isLoading,
          onRetry: () => void payments.refetch(),
        }}
        purchases={{
          data: purchaseRows,
          error: purchases.error,
          isFetching: purchases.isFetching,
          isLoading: purchases.isLoading,
          onRetry: () => void purchases.refetch(),
        }}
        sales={{
          data: salesRows,
          error: sales.error,
          isFetching: sales.isFetching,
          isLoading: sales.isLoading,
          onRetry: () => void sales.refetch(),
        }}
      />
    </div>
  );
}
