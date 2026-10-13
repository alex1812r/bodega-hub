import { ApiError } from "@/lib/api/apiError";
import { mockEntityStoreId } from "@/lib/api/assertStoreResource";
import type { PaginatedList } from "@/lib/api/pagination";
import { mockContacts, type ContactMock, type ContactType } from "@/shared/mocks/erp-data";

/**
 * Lo único que la pantalla de compras necesita de un proveedor. Se entrega con
 * `purchases.create`, sin `contacts.view`: ni teléfono, ni dirección, ni correo.
 */
export type PurchaseSupplier = {
  id: string;
  isActive: boolean;
  name: string;
  taxId: string;
};

export type PurchaseSuppliersQuery = {
  limit: number;
  search?: string;
  skip: number;
};

export const PURCHASE_SUPPLIER_TYPES: ContactType[] = ["proveedor", "ambos"];
export const PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE = "Proveedor no encontrado.";

function isSupplierOfStore(contact: ContactMock, storeId: string) {
  return (
    mockEntityStoreId(contact) === storeId && PURCHASE_SUPPLIER_TYPES.includes(contact.type)
  );
}

function toPurchaseSupplier(contact: ContactMock): PurchaseSupplier {
  return {
    id: contact.id,
    isActive: contact.isActive,
    name: contact.name,
    taxId: contact.taxId,
  };
}

/** Proveedores activos de la tienda, por nombre o RIF, ordenados por nombre. */
export function listPurchaseSuppliers(
  { limit, search, skip }: PurchaseSuppliersQuery,
  storeId: string,
): PaginatedList<PurchaseSupplier> {
  const term = search?.toLowerCase();
  const matches = mockContacts
    .filter(
      (contact) =>
        isSupplierOfStore(contact, storeId) &&
        contact.isActive &&
        (!term ||
          [contact.name, contact.taxId].some((value) => value.toLowerCase().includes(term))),
    )
    .sort((first, second) => first.name.localeCompare(second.name));

  return {
    items: matches.slice(skip, skip + limit).map(toPurchaseSupplier),
    limit,
    skip,
    total: matches.length,
  };
}

/** Un proveedor de la tienda por id, también si está inactivo (borrador o compra duplicada). */
export function getPurchaseSupplierById(id: string, storeId: string): PurchaseSupplier {
  const contact = mockContacts.find((item) => item.id === id);

  if (!contact || !isSupplierOfStore(contact, storeId)) {
    throw new ApiError(404, "NOT_FOUND", PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE);
  }

  return toPurchaseSupplier(contact);
}
