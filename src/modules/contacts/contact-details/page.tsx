"use client";

import { Pencil } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { MAX_PAGE_LIMIT, type PaginatedList, getPaginatedItems } from "@/lib/api/pagination";
import { useOpenDocuments } from "@/modules/payments/hooks/useOpenDocuments";
import { Can } from "@/shared/auth/Can";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { DetailSkeleton } from "@/shared/components/DetailSkeleton";
import { ErrorState } from "@/shared/components/ErrorState";
import { useCurrentUrl } from "@/shared/hooks/useCurrentUrl";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import { withUrlListBoundary } from "@/shared/hooks/useUrlListState";
import type { PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";

import { getContactBalanceSections } from "./components/ContactBalancesTab";
import { ContactDetailActivityTabs } from "./components/ContactDetailActivityTabs";
import {
  ContactDetailMetrics,
  type ContactMetricCoverage,
} from "./components/ContactDetailMetrics";
import { ContactDetailPageHeader } from "./components/ContactDetailPageHeader";
import { ContactFormModal } from "./components/ContactFormModal";
import { ContactProfileCard } from "./components/ContactProfileCard";
import { computeContactDetailMetrics, openBalanceRef } from "./utils/computeContactDetailMetrics";
import {
  type ContactInput,
  useContact,
  useContactPayments,
  useContactPurchases,
  useContactSales,
  useUpdateContact,
} from "../hooks/useContacts";

type ContactDetailsPageProps = {
  contactId?: string;
};

/**
 * Filas con las que se suman los totales de la cabecera: lo máximo que entrega
 * el BFF en una página. Consulta aparte de la de cada pestaña, para que el
 * resumen no cambie al pasar de página.
 */
const SUMMARY_PAGE = { limit: MAX_PAGE_LIMIT } as const;

function coverageOf(list: PaginatedList<unknown> | undefined): ContactMetricCoverage | undefined {
  return list ? { loaded: list.items.length, total: list.total } : undefined;
}

function ContactDetails({ contactId = "cont-customer" }: ContactDetailsPageProps) {
  const { can, role } = usePermission();
  const customersOnly = role ? !canViewSupplierContacts(role) : false;
  const canViewPurchases = can("purchases.view");
  const contact = useContact(contactId);
  const sales = useContactSales(contactId, SUMMARY_PAGE);
  const purchases = useContactPurchases(canViewPurchases ? contactId : undefined, SUMMARY_PAGE);
  const payments = useContactPayments(contactId, SUMMARY_PAGE);
  const updateContact = useUpdateContact(contactId);
  // Al volver de un enlace del detalle, el scroll queda donde estaba. Se restaura una
  // vez, con el contacto y la sublista de la pestaña activa ya pintados; cambiar de
  // pestaña o de página después no lo mueve.
  const detailUrl = useCurrentUrl();
  const [isSubListReady, setIsSubListReady] = useState(false);
  const markSubListReady = useCallback(() => setIsSubListReady(true), []);

  useScrollRestoration(detailUrl, { ready: Boolean(contact.data) && isSubListReady });

  // "Por cobrar" y "Por pagar" salen de la MISMA consulta que la pestaña Saldos (misma
  // clave: una sola caché y se refrescan juntas), no de las filas de ventas, compras y
  // pagos cargadas, que con un contacto grande dejan el saldo mal. Misma regla de permisos
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
      computeContactDetailMetrics(
        getPaginatedItems(sales.data) as SaleMock[],
        canViewPurchases ? (getPaginatedItems(purchases.data) as PurchaseMock[]) : [],
        getPaginatedItems(payments.data) as PaymentMock[],
        { payableRef, receivableRef },
      ),
    [canViewPurchases, payableRef, payments.data, purchases.data, receivableRef, sales.data],
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
        }
        isActive={data.isActive}
        name={data.name}
        summary={
          <ContactDetailMetrics
            contactType={data.type}
            coverage={{
              payments: coverageOf(payments.data),
              purchases: coverageOf(purchases.data),
              sales: coverageOf(sales.data),
            }}
            metrics={metrics}
          />
        }
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

      <ContactProfileCard contact={data} />

      <ContactDetailActivityTabs
        contactId={contactId}
        contactName={data.name}
        contactType={data.type}
        onSubListReady={markSubListReady}
      />
    </div>
  );
}

export const ContactDetailsPage = withUrlListBoundary(ContactDetails);
