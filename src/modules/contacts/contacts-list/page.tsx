"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Badge } from "@/shared/components/Badge";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import type { ContactMock } from "@/shared/mocks/erp-data";

import { ContactFormModal } from "../contact-details/components/ContactFormModal";
import {
  contactsQueryKeys,
  type ContactInput,
  type ContactsFilters,
  useContacts,
  useCreateContact,
} from "../hooks/useContacts";

const typeVariant = {
  cliente: "info",
  proveedor: "warning",
  ambos: "success",
} as const;

const columns: DataTableColumn<ContactMock>[] = [
  {
    header: "Nombre",
    hideInCard: true,
    key: "name",
    render: (contact) => contact.name,
  },
  {
    header: "Tipo",
    key: "type",
    render: (contact) => (
      <Badge variant={typeVariant[contact.type]}>{contact.type}</Badge>
    ),
  },
  {
    header: "Telefono",
    key: "phone",
    render: (contact) => contact.phone,
    visibility: "md",
  },
  {
    header: "Direccion",
    key: "address",
    render: (contact) => contact.address,
    visibility: "lg",
  },
];

export function ContactsListPage() {
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const [filters, setFilters] = useState<Pick<ContactsFilters, "search" | "type">>({});
  const { limit, setLimit, setSkip, skip } = usePaginationState([filters.search, filters.type]);
  const contacts = useContacts({ ...filters, limit, skip });
  const createContact = useCreateContact();

  async function handleCreateContact(input: ContactInput) {
    await createContact.mutateAsync(input);
  }

  return (
    <EntityListPage
      actions={
        <Can permission="contacts.manage">
          <ContactFormModal
            errorMessage={createContact.error?.message}
            isSubmitting={createContact.isPending}
            onSubmit={handleCreateContact}
          />
        </Can>
      }
      description={`Listado de clientes y proveedores ${getConnectedToApiPhrase()} con filtros de tipo y busqueda.`}
      title="Contactos"
    >
      <FilterPanel>
        <Input
          label="Nombre, documento o telefono"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              search: event.target.value || undefined,
            }))
          }
          placeholder="Buscar contacto"
          value={filters.search ?? ""}
        />
        <SelectField
          label="Tipo"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              type: event.target.value || undefined,
            }))
          }
          options={[
            { label: "Cliente", value: "cliente" },
            { label: "Proveedor", value: "proveedor" },
            { label: "Cliente y proveedor", value: "ambos" },
          ]}
          placeholder="Todos"
          value={filters.type ?? ""}
        />
      </FilterPanel>

      <DataTable
        cardSubtitle={(contact) => contact.type}
        cardTitle={(contact) => contact.name}
        actions={(contact) => {
          const items: ActionMenuItem[] = [
            { href: `/contacts/${contact.id}`, label: "Ver perfil" },
          ];

          if (can("contacts.manage")) {
            items.push({ href: `/contacts/${contact.id}`, label: "Editar" });
          }

          if (contact.isActive && can("contacts.manage")) {
            items.push({
              label: "Desactivar",
              onSelect: () => {
                void apiFetch(`/api/contacts/${contact.id}`, {
                  body: { isActive: false },
                  method: "PATCH",
                }).then(() => {
                  void queryClient.invalidateQueries({ queryKey: contactsQueryKeys.all });
                });
              },
              variant: "danger" as const,
            });
          }

          return items;
        }}
        columns={columns}
        data={getPaginatedItems(contacts.data)}
        error={contacts.error}
        getRowId={(contact) => contact.id}
        isFetching={contacts.isFetching}
        isLoading={contacts.isLoading}
        onRetry={() => void contacts.refetch()}
      />
      <ResponsivePagination
        isDisabled={contacts.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={contacts.data?.skip ?? skip}
        total={contacts.data?.total ?? 0}
      />
    </EntityListPage>
  );
}
