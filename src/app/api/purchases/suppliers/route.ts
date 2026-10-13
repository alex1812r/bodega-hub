import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { safeText } from "@/modules/purchases/schemas/safeText";
import * as purchaseSuppliersMockServer from "@/modules/purchases/services/purchaseSuppliers.mock-server";
import * as purchaseSuppliersServer from "@/modules/purchases/services/purchaseSuppliers.server";

const DEFAULT_SUPPLIERS_LIMIT = 8;
const MAX_SUPPLIERS_LIMIT = 20;
const MAX_SEARCH_LENGTH = 100;
const MAX_ID_LENGTH = 64;

const wholeNumber = (message: string) => z.string().regex(/^\d{1,9}$/, message).transform(Number);

const listQuerySchema = z.object({
  limit: wholeNumber("El límite debe ser un número entero.")
    .refine((value) => value >= 1, "El límite debe ser al menos 1.")
    .transform((value) => Math.min(value, MAX_SUPPLIERS_LIMIT))
    .default(DEFAULT_SUPPLIERS_LIMIT),
  search: safeText()
    .max(MAX_SEARCH_LENGTH, `La búsqueda admite hasta ${MAX_SEARCH_LENGTH} caracteres.`)
    .optional(),
  skip: wholeNumber("El desplazamiento debe ser un número entero.").default(0),
});

const supplierIdSchema = z
  .string()
  .max(MAX_ID_LENGTH, "El identificador del proveedor no es válido.")
  .regex(/^[A-Za-z0-9_-]+$/, "El identificador del proveedor no es válido.");

/** Un parámetro vacío o en blanco equivale a no enviarlo. */
function readListQuery(searchParams: URLSearchParams) {
  return listQuerySchema.parse(
    Object.fromEntries(
      (["limit", "search", "skip"] as const).flatMap((key) => {
        const value = searchParams.get(key)?.trim();
        return value ? [[key, value]] : [];
      }),
    ),
  );
}

function getPurchaseSuppliersService() {
  return resolveDataSource() === "supabase" ? purchaseSuppliersServer : purchaseSuppliersMockServer;
}

/**
 * Proveedores para registrar una compra. Se autoriza con `purchases.create` (el rol
 * almacén no tiene `contacts.view`) y por eso solo entrega `id`, `name`, `taxId` e
 * `isActive`. Con `id` devuelve ese proveedor, activo o no; sin él, la búsqueda.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const searchParams = new URL(request.url).searchParams;
    const service = getPurchaseSuppliersService();
    const id = searchParams.get("id");

    if (id !== null) {
      return jsonData(
        await service.getPurchaseSupplierById(supplierIdSchema.parse(id), auth.storeId),
      );
    }

    return jsonData(await service.listPurchaseSuppliers(readListQuery(searchParams), auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
