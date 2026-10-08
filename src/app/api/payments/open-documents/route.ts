import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { parsePagination } from "@/lib/api/pagination";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import * as openDocumentsMockServer from "@/modules/payments/services/openDocuments.mock-server";
import type { OpenDocumentType } from "@/modules/payments/services/openDocuments.mock-server";
import * as openDocumentsServer from "@/modules/payments/services/openDocuments.server";
import {
  canViewPurchasePayments,
  PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE,
} from "@/shared/auth/paymentAccess";
import type { Permission } from "@/shared/auth/permissions";

const QUERY_KEYS = ["type", "search", "contactId", "from", "to", "olderThanDays"] as const;

/** Fecha de calendario Caracas `YYYY-MM-DD` que ademas exista (no `2026-02-31`). */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La fecha no es valida.");

const openDocumentsQuerySchema = z
  .object({
    contactId: z.string().max(120).optional(),
    from: isoDateSchema.optional(),
    olderThanDays: z
      .string()
      .regex(/^\d+$/, "olderThanDays debe ser un entero mayor o igual a 1.")
      .transform(Number)
      .pipe(z.number().int().min(1).max(3650))
      .optional(),
    search: z.string().max(120).optional(),
    to: isoDateSchema.optional(),
    type: z.enum(["sale", "purchase"]).optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "La fecha inicial no puede ser posterior a la final.",
    path: ["from"],
  });

/** Un parametro vacio o en blanco equivale a no enviarlo. */
function readQuery(searchParams: URLSearchParams) {
  return Object.fromEntries(
    QUERY_KEYS.flatMap((key) => {
      const value = searchParams.get(key)?.trim();
      return value ? [[key, value]] : [];
    }),
  );
}

function getOpenDocumentsService() {
  return resolveDataSource() === "supabase" ? openDocumentsServer : openDocumentsMockServer;
}

export async function GET(request: Request) {
  try {
    // Misma regla que POST /api/payments: las ventas se cobran con payments.manage
    // o sales.create; las compras exigen payments.manage y un rol que vea pagos de compra.
    const auth = await requireStoreAnyPermission(request, [
      "payments.manage",
      "sales.create",
    ] satisfies Permission[]);
    const searchParams = new URL(request.url).searchParams;
    const { type, ...filters } = openDocumentsQuerySchema.parse(readQuery(searchParams));

    const canListPurchases =
      auth.permissions.includes("payments.manage") && canViewPurchasePayments(auth.role);

    if (type === "purchase" && !canListPurchases) {
      throw new ApiError(403, "FORBIDDEN", PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);
    }

    const types: OpenDocumentType[] = type
      ? [type]
      : canListPurchases
        ? ["sale", "purchase"]
        : ["sale"];

    return jsonData(
      await getOpenDocumentsService().listOpenDocuments(
        { ...filters, ...parsePagination(searchParams), types },
        auth.storeId,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
