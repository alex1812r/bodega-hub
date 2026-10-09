"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import { Can } from "@/shared/auth/Can";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import {
  getTotalPages,
  ResponsivePagination,
  useUrlPaginationState,
} from "@/shared/components/Pagination";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import type { ContactMock } from "@/shared/mocks/erp-data";
import { withReturnTo } from "@/shared/utils/returnTo";

import { ContactFormModal } from "../contact-details/components/ContactFormModal";
import {
  contactsQueryKeys,
  type ContactInput,
  useContacts,
  useCreateContact,
  useUpdateContact,
} from "../hooks/useContacts";
import { ContactDeactivateConfirmModal } from "./components/ContactDeactivateConfirmModal";
import { ContactInfoCell } from "./components/ContactInfoCell";
import { ContactNameCell } from "./components/ContactNameCell";
import { ContactsExportActions } from "./components/ContactsExportActions";
import { ContactsListFilters } from "./components/ContactsListFilters";
import { ContactsStatusBadge } from "./components/ContactsStatusBadge";
import { ContactsTypeBadge } from "./components/ContactsTypeBadge";
import { contactsListSchema, toContactsFilters } from "./contactsListParams";

const cardTitleLinkClass =
  "rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Columna del nombre; `detailHref` lleva al perfil con la URL de la lista en `returnTo`. */
function buildNameColumn(
  detailHref: (contactId: string) => string,
): DataTableColumn<ContactMock> {
  return {
    header: "Nombre / Razón Social",
    hideInCard: true,
    key: "name",
    render: (contact) => <ContactNameCell href={detailHref(contact.id)} name={contact.name} />,
  };
}

const staticColumns: DataTableColumn<ContactMock>[] = [
  {
    align: "center",
    header: "Tipo",
    key: "type",
    render: (contact) => (
      <div className="flex justify-center">
        <ContactsTypeBadge type={contact.type} />
      </div>
    ),
  },
  {
    cellClassName: "font-mono text-sm text-on-surface-variant",
    header: "RIF / Cédula",
    key: "taxId",
    render: (contact) => contact.taxId || "—",
    visibility: "md",
  },
  {
    header: "Contacto",
    key: "contact",
    render: (contact) => (
      <ContactInfoCell email={contact.email} phone={contact.phone} />
    ),
    visibility: "lg",
  },
  {
    align: "center",
    header: "Estado",
    key: "status",
    render: (contact) => (
      <div className="flex justify-center">
        <ContactsStatusBadge isActive={contact.isActive} />
      </div>
    ),
  },
];

function ContactsList() {
  const queryClient = useQueryClient();
  const { can, role } = usePermission();
  const customersOnly = role ? !canViewSupplierContacts(role) : false;
  // Búsqueda, filtros, página y tamaño viven en la URL: recarga, "atrás" y volver del perfil los conservan.
  const list = useUrlListState(contactsListSchema);
  const [editingContact, setEditingContact] = useState<ContactMock | null>(null);
  const [contactToDeactivate, setContactToDeactivate] = useState<ContactMock | null>(null);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const effectiveFilters = toContactsFilters(list.state, debouncedSearch, customersOnly);
  const contacts = useContacts({ ...effectiveFilters, limit, skip });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact(editingContact?.id ?? "");
  const contactItems = getPaginatedItems(contacts.data);
  const totalContacts = contacts.data?.total ?? 0;
  const { href: listHref, setState: setListState } = list;
  // El perfil vuelve a esta URL exacta (filtros y página) con "Volver".
  const columns = useMemo(
    () => [
      buildNameColumn((contactId) => withReturnTo(`/contacts/${contactId}`, listHref)),
      ...staticColumns,
    ],
    [listHref],
  );
  const lastPage = getTotalPages(totalContacts, limit);
  const isPastLastPage = contacts.isSuccess && !contacts.isFetching && list.state.page > lastPage;

  // Una página más allá de la última (`?page=9999`, o un enlace viejo) cae en la
  // última que existe, y la URL lo refleja.
  useEffect(() => {
    if (isPastLastPage) {
      setListState({ page: lastPage });
    }
  }, [isPastLastPage, lastPage, setListState]);

  useScrollRestoration(listHref, { ready: !contacts.isLoading });

  async function handleCreateContact(input: ContactInput) {
    return createContact.mutateAsync(input);
  }

  // Al abrir un alta o una edición no debe verse el error de un guardado anterior.
  function handleCreateOpenChange(open: boolean) {
    if (open) {
      createContact.reset();
    }
  }

  function openContactEdit(contact: ContactMock) {
    updateContact.reset();
    setEditingContact(contact);
  }

  async function handleUpdateContact(input: ContactInput) {
    if (!editingContact) {
      return;
    }

    await updateContact.mutateAsync(input);
    setEditingContact(null);
  }

  // Reactivar no arrastra nada más: es directo. Desactivar confirma con su efecto.
  async function activateContact(contact: ContactMock) {
    await apiFetch(`/api/contacts/${contact.id}`, {
      body: { isActive: true },
      method: "PATCH",
    });
    await queryClient.invalidateQueries({ queryKey: contactsQueryKeys.all });
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <ContactsExportActions exportFilters={effectiveFilters} />
            <Can permission="contacts.manage">
              <ContactFormModal
                customersOnly={customersOnly}
                errorMessage={createContact.error?.message}
                isSubmitting={createContact.isPending}
                onOpenChange={handleCreateOpenChange}
                onSubmit={handleCreateContact}
                trigger={
                  <Button className="w-full gap-2 shadow-sm sm:w-auto" size="sm">
                    <Plus aria-hidden className="size-5" />
                    Nuevo contacto
                  </Button>
                }
              />
            </Can>
          </div>
        }
        description={
          customersOnly
            ? "Gestione el directorio de clientes de la empresa."
            : "Gestione el directorio de clientes y proveedores de la empresa."
        }
        layout="sections"
        title="Contactos"
      >
        <ContactsListFilters
          customersOnly={customersOnly}
          onChange={list.setState}
          state={list.state}
        />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(contact) => {
              const items: ActionMenuItem[] = [
                { href: withReturnTo(`/contacts/${contact.id}`, listHref), label: "Ver perfil" },
              ];

              if (can("contacts.manage")) {
                items.push({
                  label: "Editar",
                  onSelect: () => openContactEdit(contact),
                });

                if (contact.isActive) {
                  items.push({
                    label: "Desactivar",
                    onSelect: () => setContactToDeactivate(contact),
                    variant: "danger",
                  });
                } else {
                  items.push({
                    label: "Activar",
                    onSelect: () => {
                      void activateContact(contact);
                    },
                  });
                }
              }

              return items;
            }}
            cardSubtitle={(contact) => contact.taxId || "Sin documento"}
            cardTitle={(contact) => (
              <Link
                className={cardTitleLinkClass}
                href={withReturnTo(`/contacts/${contact.id}`, listHref)}
              >
                {contact.name}
              </Link>
            )}
            columns={columns}
            data={contactItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="contacts.manage">
                    <ContactFormModal
                      customersOnly={customersOnly}
                      errorMessage={createContact.error?.message}
                      isSubmitting={createContact.isPending}
                      onOpenChange={handleCreateOpenChange}
                      onSubmit={handleCreateContact}
                      trigger={
                        <Button className="gap-2" size="sm">
                          <Plus aria-hidden className="size-5" />
                          Nuevo contacto
                        </Button>
                      }
                    />
                  </Can>
                }
                description="Crea un contacto o ajusta los filtros para ver otros resultados."
                title="No hay contactos para mostrar"
              />
            }
            error={contacts.error ?? createContact.error}
            getRowId={(contact) => contact.id}
            isFetching={contacts.isFetching}
            isLoading={contacts.isLoading}
            onRetry={() => void contacts.refetch()}
            variant="stitch-purchases"
          />

          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="contactos"
              isDisabled={contacts.isFetching}
              limit={limit}
              onLimitChange={setLimit}
              onSkipChange={setSkip}
              skip={contacts.data?.skip ?? skip}
              total={totalContacts}
              variant="stitch"
            />
          </div>
        </div>
      </EntityListPage>

      <ContactDeactivateConfirmModal
        contact={contactToDeactivate}
        onOpenChange={(open) => {
          if (!open) {
            setContactToDeactivate(null);
          }
        }}
      />

      {editingContact ? (
        <ContactFormModal
          contact={editingContact}
          customersOnly={customersOnly}
          errorMessage={updateContact.error?.message}
          isSubmitting={updateContact.isPending}
          mode="edit"
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setEditingContact(null);
            }
          }}
          onSubmit={handleUpdateContact}
          open
          trigger={null}
        />
      ) : null}
    </div>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const ContactsListPage = withUrlListBoundary(ContactsList);
