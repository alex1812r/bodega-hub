"use client";

import { Pencil } from "lucide-react";
import { useMemo } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { Can } from "@/shared/auth/Can";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { MAX_PAGE_LIMIT, getPaginatedItems } from "@/lib/api/pagination";
import { useOpenDocuments } from "@/modules/payments/hooks/useOpenDocuments";
import { Button } from "@/shared/components/Button";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import type { PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";
import { formatDate } from "@/shared/utils/date";

import { buildActivityTimelineItems } from "./components/ContactActivityTimeline";
import { getContactBalanceSections } from "./components/ContactBalancesTab";
import { ContactDetailActivityTabs } from "./components/ContactDetailActivityTabs";
import { ContactDetailMetrics } from "./components/ContactDetailMetrics";
import { ContactDetailPageHeader } from "./components/ContactDetailPageHeader";
import { ContactFormModal } from "./components/ContactFormModal";
import { ContactProfileCard } from "./components/ContactProfileCard";
import { computeContactDetailMetrics, openBalanceRef } from "./utils/computeContactDetailMetrics";
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
  const { can, role } = usePermission();
  const customersOnly = role ? !canViewSupplierContacts(role) : false;
  const canViewPurchases = can("purchases.view");
  const contact = useContact(contactId);
  const activity = useContactActivity(contactId);
  const sales = useContactSales(contactId);
  const purchases = useContactPurchases(canViewPurchases ? contactId : undefined);
  const payments = useContactPayments(contactId);
  const updateContact = useUpdateContact(contactId);

  const salesRows = getPaginatedItems(sales.data) as SaleMock[];
  const purchaseRows = canViewPurchases
    ? (getPaginatedItems(purchases.data) as PurchaseMock[])
    : [];
  const paymentRows = getPaginatedItems(payments.data) as PaymentMock[];

  // "Por cobrar" y "Por pagar" salen de la MISMA consulta que la pestaña Saldos (misma
  // clave: una sola caché y se refrescan juntas), no de la primera página de ventas,
  // compras y pagos, que con más de 10 pagos deja el saldo mal. Misma regla de permisos
  // que la pestaña: sin una sección, esa métrica conserva el cálculo con las filas.
  const balanceSections = contact.data
    ? getContactBalanceSections(contact.data.type, { can, role })
    : [];
  const openSales = useOpenDocuments(
    { contactId, limit: MAX_PAGE_LIMIT, type: "sale" },
    { enabled: Boolean(contactId) && balanceSections.includes("sale") },
  );
  const openPurchases = useOpenDocuments(
    { contactId, limit: MAX_PAGE_LIMIT, type: "purchase" },
    { enabled: Boolean(contactId) && balanceSections.includes("purchase") },
  );
  const receivableRef = openBalanceRef(openSales.data?.totals);
  const payableRef = openBalanceRef(openPurchases.data?.totals);

  const metrics = useMemo(
    () =>
      contact.data
        ? computeContactDetailMetrics(contact.data.type, salesRows, purchaseRows, paymentRows, {
            payableRef,
            receivableRef,
          })
        : null,
    [contact.data, payableRef, paymentRows, purchaseRows, receivableRef, salesRows],
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

  // Al abrir la edición no debe verse el error de un guardado anterior.
  function handleEditOpenChange(open: boolean) {
    if (open) {
      updateContact.reset();
    }
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
                customersOnly={customersOnly}
                errorMessage={updateContact.error?.message}
                isSubmitting={isSaving}
                mode="edit"
                onOpenChange={handleEditOpenChange}
                onSubmit={handleUpdateContact}
                // `Button` directo: el disparador recibe del modal el `onClick` que lo abre.
                trigger={
                  <Button className="w-full gap-2 sm:w-auto" disabled={isSaving} size="sm">
                    <Pencil aria-hidden className="size-[1.125rem]" />
                    {isSaving ? "Guardando..." : "Editar"}
                  </Button>
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
