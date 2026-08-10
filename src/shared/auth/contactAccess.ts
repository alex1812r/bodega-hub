import { ApiError } from "@/lib/api/apiError";

import type { UserRole } from "./permissions";

export const SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE =
  "No tienes permiso para acceder a contactos de tipo proveedor.";

/** El vendedor solo puede ver contactos estrictamente de tipo cliente. */
export function canViewSupplierContacts(role: UserRole) {
  return role !== "vendedor";
}

export function isCustomerContactType(type: string | null | undefined) {
  return type === "cliente";
}

export function isSupplierContactType(type: string | null | undefined) {
  return type === "proveedor" || type === "ambos";
}

export function assertCanAccessContact(
  role: UserRole,
  contact: { type?: string | null },
) {
  if (!canViewSupplierContacts(role) && !isCustomerContactType(contact.type)) {
    throw new ApiError(403, "FORBIDDEN", SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE);
  }
}

export function assertCanQueryContactType(role: UserRole, searchParams: URLSearchParams) {
  if (canViewSupplierContacts(role)) {
    return;
  }

  const type = searchParams.get("type");
  if (type && type !== "cliente") {
    throw new ApiError(403, "FORBIDDEN", SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE);
  }
}

export function assertCanWriteContactType(
  role: UserRole,
  type: string | null | undefined,
) {
  if (!canViewSupplierContacts(role) && type && type !== "cliente") {
    throw new ApiError(403, "FORBIDDEN", SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE);
  }
}

export function assertCanAccessSupplierContacts(role: UserRole) {
  if (!canViewSupplierContacts(role)) {
    throw new ApiError(403, "FORBIDDEN", SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE);
  }
}
