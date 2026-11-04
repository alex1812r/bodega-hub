import { canViewSupplierContacts } from "./contactAccess";
import type { Permission, UserRole } from "./permissions";

/** Permiso efectivo que exige `GET /api/suppliers/[id]/products`, además del acceso a proveedores. */
export const SUPPLIER_PRODUCTS_PERMISSION = "products.view" satisfies Permission;

/**
 * La condición de `GET /api/suppliers/[id]/products`: `SUPPLIER_PRODUCTS_PERMISSION` efectivo y
 * acceso a contactos de tipo proveedor (`assertCanAccessSupplierContacts`). `can` dice si el
 * usuario tiene un permiso efectivo; sirve en cliente (`usePermission`) y en servidor.
 */
export function canReadSupplierProducts(role: UserRole, can: (permission: Permission) => boolean) {
  return can(SUPPLIER_PRODUCTS_PERMISSION) && canViewSupplierContacts(role);
}
