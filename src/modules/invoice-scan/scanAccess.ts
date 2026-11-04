import { ApiError } from "@/lib/api/apiError";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { canReadSupplierProducts } from "@/shared/auth/supplierProductsAccess";

export const INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE =
  "No puedes escanear facturas: para cargarlas en la compra hace falta ver los productos de los proveedores (permiso «Ver productos» y acceso a proveedores).";

/**
 * D80: escanear una factura de compra exige poder cargarla en la compra, que lee los productos
 * del proveedor (`GET /api/suppliers/[id]/products`). Así nadie paga una página que no puede usar.
 */
export const canLoadInvoiceIntoPurchase = canReadSupplierProducts;

/** 403 con el motivo si el usuario de la sesión (permisos efectivos) no puede cargar la factura. */
export function assertCanLoadInvoiceIntoPurchase(auth: { permissions: readonly Permission[]; role: UserRole }) {
  if (!canLoadInvoiceIntoPurchase(auth.role, (permission) => auth.permissions.includes(permission))) {
    throw new ApiError(403, "FORBIDDEN", INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE);
  }
}
