"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import type { ContactMock } from "@/shared/mocks/erp-data";

import { ContactFormModal } from "../contact-details/components/ContactFormModal";
import {
  contactsQueryKeys,
  type ContactInput,
  type ContactsFilters,
  useContacts,
  useCreateContact,
  useUpdateContact,
} from "../hooks/useContacts";
import { ContactInfoCell } from "./components/ContactInfoCell";
import { ContactNameCell } from "./components/ContactNameCell";
import { ContactsExportActions } from "./components/ContactsExportActions";
import { ContactsListFilters } from "./components/ContactsListFilters";
import { ContactsStatusBadge } from "./components/ContactsStatusBadge";
import { ContactsTypeBadge } from "./components/ContactsTypeBadge";

const columns: DataTableColumn<ContactMock>[] = [
  {
    header: "Nombre / Razón Social",
    hideInCard: true,
    key: "name",
    render: (contact) => <ContactNameCell name={contact.name} />,
  },
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

export function ContactsListPage() {
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const [filters, setFilters] = useState<
    Pick<ContactsFilters, "isActive" | "search" | "type">
  >({});
  const [editingContact, setEditingContact] = useState<ContactMock | null>(null);
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.search,
    filters.type,
    filters.isActive,
  ]);
  const contacts = useContacts({ ...filters, limit, skip });
  const createContact = useCreateContact();
  const updateContact = useUpdateContact(editingContact?.id ?? "");
  const contactItems = getPaginatedItems(contacts.data);
  const totalContacts = contacts.data?.total ?? 0;

  function handleFilterChange(patch: Partial<ContactsFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  async function handleCreateContact(input: ContactInput) {
    await createContact.mutateAsync(input);
  }

  async function handleUpdateContact(input: ContactInput) {
    if (!editingContact) {
      return;
    }

    await updateContact.mutateAsync(input);
    setEditingContact(null);
  }

  async function toggleContactActive(contact: ContactMock) {
    await apiFetch(`/api/contacts/${contact.id}`, {
      body: { isActive: !contact.isActive },
      method: "PATCH",
    });
    await queryClient.invalidateQueries({ queryKey: contactsQueryKeys.all });
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <ContactsExportActions exportFilters={filters} />
            <Can permission="contacts.manage">
              <ContactFormModal
                errorMessage={createContact.error?.message}
                isSubmitting={createContact.isPending}
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
        description="Gestione el directorio de clientes y proveedores de la empresa."
        layout="sections"
        title="Contactos"
      >
        <ContactsListFilters filters={filters} onChange={handleFilterChange} />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(contact) => {
              const items: ActionMenuItem[] = [
                { href: `/contacts/${contact.id}`, label: "Ver perfil" },
              ];

              if (can("contacts.manage")) {
                items.push({
                  label: "Editar",
                  onSelect: () => setEditingContact(contact),
                });

                if (contact.isActive) {
                  items.push({
                    label: "Desactivar",
                    onSelect: () => {
                      void toggleContactActive(contact);
                    },
                    variant: "danger",
                  });
                } else {
                  items.push({
                    label: "Activar",
                    onSelect: () => {
                      void toggleContactActive(contact);
                    },
                  });
                }
              }

              return items;
            }}
            cardSubtitle={(contact) => contact.taxId || "Sin documento"}
            cardTitle={(contact) => contact.name}
            columns={columns}
            data={contactItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="contacts.manage">
                    <ContactFormModal
                      errorMessage={createContact.error?.message}
                      isSubmitting={createContact.isPending}
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

      {editingContact ? (
        <ContactFormModal
          contact={editingContact}
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
