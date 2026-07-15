import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import type { ContactMock } from "@/shared/mocks/erp-data";

import type { ContactsFilters } from "../hooks/useContacts";

export type ContactsExportFilters = Pick<ContactsFilters, "isActive" | "search" | "type">;

function pickContactsQuery(filters: ContactsExportFilters) {
  return {
    isActive: filters.isActive,
    search: filters.search,
    type: filters.type,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchContactsForExport(
  filters: ContactsExportFilters,
): Promise<ContactMock[]> {
  return fetchAllPaginatedItems<ContactMock>("/api/contacts", pickContactsQuery(filters));
}
