import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { purchaseItemInputSchema } from "@/modules/purchases/schemas/purchaseItem.schema";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

const createPurchaseSchema = z.object({
  // Clave de idempotencia por intento (C6): con la misma clave en la misma tienda
  // el servidor devuelve el resultado original en vez de repetir el movimiento.
  // Opcional para no romper clientes que aun no la envian.
  clientRequestId: z.string().uuid().optional(),
  discountRef: z.number().min(0),
  discountVes: z.number().min(0),
  exchangeRateId: z.string().uuid().optional(),
  items: z.array(purchaseItemInputSchema).min(1),
  notes: z.string().optional(),
  purchaseNumber: z.string().optional(),
  refRateVes: z.number().positive(),
  status: z.enum(["pedido", "recibido"]).default("recibido"),
  subtotalRef: z.number().min(0),
  subtotalVes: z.number().min(0),
  supplierId: z.string().min(1),
  taxRef: z.number().min(0),
  taxVes: z.number().min(0),
});

const LIST_FILTER_KEYS = ["from", "to", "pendingBalance"] as const;

/** Fecha de calendario Caracas `YYYY-MM-DD` que además exista (no `2026-02-31`). */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La fecha no es válida.");

const listPurchasesQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    pendingBalance: z
      .literal("1", { message: "El filtro de saldo pendiente solo admite el valor 1." })
      .optional(),
    to: isoDateSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "La fecha inicial no puede ser posterior a la final.",
    path: ["from"],
  });

/**
 * Valida `from`, `to` y `pendingBalance` y los deja normalizados en la query que
 * reciben los servicios: un parámetro vacío o en blanco equivale a no enviarlo.
 */
function withValidatedListFilters(searchParams: URLSearchParams) {
  const filters = listPurchasesQuerySchema.parse(
    Object.fromEntries(
      LIST_FILTER_KEYS.flatMap((key) => {
        const value = searchParams.get(key)?.trim();
        return value ? [[key, value]] : [];
      }),
    ),
  );
  const normalized = new URLSearchParams(searchParams);

  for (const key of LIST_FILTER_KEYS) {
    const value = filters[key];

    if (value) {
      normalized.set(key, value);
    } else {
      normalized.delete(key);
    }
  }

  return normalized;
}

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.view");
    const searchParams = withValidatedListFilters(new URL(request.url).searchParams);
    const service = getPurchasesService();
    return jsonData(await service.listPurchases(searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const input = createPurchaseSchema.parse(await readJsonBody(request));
    const service = getPurchasesService();
    return jsonCreated(await service.createPurchase(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
