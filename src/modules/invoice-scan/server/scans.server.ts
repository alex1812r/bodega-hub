/**
 * Repositorio de `public.invoice_scans` contra Supabase (parche 20261019a).
 *
 * Usa el cliente con el JWT del usuario: la RLS limita a la tienda de la sesión
 * (lee `purchases.view`, escribe `purchases.create`) y además cada consulta
 * filtra por `ctx.storeId`. Solo la purga (cron) recibe el cliente service role.
 * Paridad en `scans.mock-server.ts`.
 */
import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import type { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { caracasDateToUtcRange, getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

import type { InvoiceExtraction, InvoiceMatch, InvoiceScanLimits } from "../contracts";
import {
  DISCARD_NOT_ALLOWED_MESSAGE,
  type ExpiredScan,
  invoiceScanPagePaths,
  MAX_FEW_SHOT_EXAMPLES,
  type StoredFewShotExample,
  type InvoiceScanCompletion,
  type InvoiceScanContext,
  type InvoiceScanReservation,
  type InvoiceScanReserveInput,
  type InvoiceScanRow,
  type InvoiceScanStatus,
} from "./scans.types";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type DbInvoiceScanRow = {
  id: string;
  store_id: string;
  created_by: string;
  image_sha256: string;
  storage_path: string;
  pages: number;
  usage_pages: number;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  extracted: InvoiceExtraction | Record<string, never>;
  matched: InvoiceMatch | Record<string, never>;
  confirmed: InvoiceExtraction | null;
  purchase_id: string | null;
  supplier_id: string | null;
  status: InvoiceScanStatus;
  error: string | null;
  created_at: string;
  confirmed_at: string | null;
};

const scanSelect =
  "id, store_id, created_by, image_sha256, storage_path, pages, usage_pages, provider, model, input_tokens, output_tokens, duration_ms, extracted, matched, confirmed, purchase_id, supplier_id, status, error, created_at, confirmed_at";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La columna guarda `{}` cuando no hay lectura (escaneo fallido). */
function nonEmpty<T extends object>(value: T | Record<string, never> | null): T | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }

  return value as T;
}

function mapScan(row: DbInvoiceScanRow): InvoiceScanRow {
  return {
    confirmed: row.confirmed,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    durationMs: row.duration_ms,
    error: row.error,
    extracted: nonEmpty<InvoiceExtraction>(row.extracted),
    id: row.id,
    imageSha256: row.image_sha256,
    inputTokens: row.input_tokens,
    matched: nonEmpty<InvoiceMatch>(row.matched),
    model: row.model,
    outputTokens: row.output_tokens,
    pages: row.pages,
    provider: row.provider,
    purchaseId: row.purchase_id,
    status: row.status,
    storagePath: row.storage_path,
    storeId: row.store_id,
    supplierId: row.supplier_id,
    usagePages: row.usage_pages,
  };
}

const reservationSchema = z.discriminatedUnion("outcome", [
  z.object({ id: z.string(), outcome: z.literal("cached") }),
  z.object({ id: z.string(), outcome: z.literal("in_progress") }),
  z.object({ limit: z.number(), outcome: z.literal("quota"), used: z.number() }),
  z.object({ id: z.string(), limit: z.number(), outcome: z.literal("reserved"), used: z.number() }),
]);

/**
 * Reserva atómica del escaneo (RPC `reserve_invoice_scan`, parche 20261019e):
 * con un lock por tienda decide caché, en curso, cuota o reserva, y en la
 * reserva deja la fila en `processing` con las páginas ya cobradas. La tienda y
 * el usuario salen del JWT dentro de la RPC.
 */
export async function reserveScan(
  _ctx: InvoiceScanContext,
  input: InvoiceScanReserveInput,
): Promise<InvoiceScanReservation> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("reserve_invoice_scan", {
    p_limit: input.limit,
    p_model: input.model,
    p_pages: input.pages,
    p_provider: input.provider,
    p_sha256: input.imageSha256,
    p_storage_path: input.storagePath,
  });

  throwIfSupabaseError(error);

  return reservationSchema.parse(data);
}

/** Cierra una reserva con la lectura. null si la fila ya no está `processing`. */
export async function completeScan(
  ctx: InvoiceScanContext,
  id: string,
  completion: InvoiceScanCompletion,
): Promise<InvoiceScanRow | null> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .update({
      duration_ms: completion.durationMs,
      error: null,
      extracted: completion.extracted,
      input_tokens: completion.inputTokens,
      matched: completion.matched,
      model: completion.model,
      output_tokens: completion.outputTokens,
      provider: completion.provider,
      status: "extracted",
    })
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .eq("status", "processing")
    .select(scanSelect)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return data ? mapScan(data) : null;
}

/** Cierra una reserva sin lectura: `failed` con el código (nunca el contenido). Las páginas ya se cobraron. */
export async function failScan(ctx: InvoiceScanContext, id: string, errorCode: string): Promise<void> {
  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase
    .from("invoice_scans")
    .update({ error: errorCode, extracted: {}, matched: {}, status: "failed" })
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .eq("status", "processing");

  throwIfSupabaseError(error);
}

/** null si el id no es de la tienda de la sesión (la ruta responde 404). */
export async function getScan(ctx: InvoiceScanContext, id: string): Promise<InvoiceScanRow | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .select(scanSelect)
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return data ? mapScan(data) : null;
}

/**
 * Descarta un escaneo `extracted`. null si no es de la tienda (404); 409 si ya
 * está confirmado, descartado o fallido.
 */
export async function discardScan(
  ctx: InvoiceScanContext,
  id: string,
): Promise<InvoiceScanRow | null> {
  const current = await getScan(ctx, id);

  if (!current) {
    return null;
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .update({ status: "discarded" })
    .eq("id", current.id)
    .eq("store_id", ctx.storeId)
    .eq("status", "extracted")
    .select(scanSelect)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(409, "CONFLICT", DISCARD_NOT_ALLOWED_MESSAGE);
  }

  return mapScan(data);
}

/**
 * Páginas cobradas hoy (día operativo de Caracas) por la tienda: suma de
 * `usage_pages`, que cuenta cada intento (fallidos y reescaneos incluidos).
 */
export async function getDailyUsage(
  ctx: InvoiceScanContext,
  limit: number,
  now: Date = new Date(),
): Promise<InvoiceScanLimits> {
  const { endUtcExclusive, startUtc } = caracasDateToUtcRange(getCaracasIsoDate(now));
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .select("usage_pages")
    .eq("store_id", ctx.storeId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtcExclusive);

  throwIfSupabaseError(error);

  const used = ((data ?? []) as { usage_pages: number }[]).reduce((sum, row) => sum + row.usage_pages, 0);

  return { limit, remaining: Math.max(0, limit - used), used };
}

/** Hasta `max` (≤ 3) escaneos confirmados del proveedor, del más reciente al más antiguo. */
export async function listFewShotExamples(
  ctx: InvoiceScanContext,
  supplierId: string,
  max: number = MAX_FEW_SHOT_EXAMPLES,
): Promise<StoredFewShotExample[]> {
  const count = Math.min(Math.max(Math.trunc(max), 0), MAX_FEW_SHOT_EXAMPLES);

  if (count === 0 || !UUID_PATTERN.test(supplierId)) {
    return [];
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .select("id, storage_path, confirmed")
    .eq("store_id", ctx.storeId)
    .eq("supplier_id", supplierId)
    .not("confirmed", "is", null)
    .order("created_at", { ascending: false })
    .limit(count);

  throwIfSupabaseError(error);

  return ((data ?? []) as { id: string; storage_path: string; confirmed: InvoiceExtraction }[]).map(
    (row) => ({ confirmed: row.confirmed, scanId: row.id, storagePath: row.storage_path }),
  );
}

/**
 * Escaneos de todas las tiendas creados hace más de `olderThanDays` días, con
 * las rutas de todas sus páginas (cron con service role): como mucho `limit`,
 * los más antiguos primero. No borra nada: el llamador borra Storage y solo
 * entonces las filas con `deleteScansByIds`.
 */
export async function listExpiredScans(
  adminClient: AdminClient,
  olderThanDays: number,
  now: Date,
  limit: number,
): Promise<ExpiredScan[]> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminClient
    .from("invoice_scans")
    .select("id, storage_path, pages")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  throwIfSupabaseError(error);

  return ((data ?? []) as { id: string; storage_path: string; pages: number }[]).map((row) => ({
    id: row.id,
    storagePaths: invoiceScanPagePaths(row.storage_path, row.pages),
  }));
}

/**
 * Objetos del bucket `invoice-scans` subidos hace más de `olderThanDays` días
 * que no pertenecen a un escaneo vivo (RPC del parche 20261019c, solo service
 * role): sobre todo páginas subidas por `upload-url` que nunca llegaron a fila.
 * Como mucho `limit`, los más antiguos primero. No borra nada.
 */
export async function listExpiredScanObjects(
  adminClient: AdminClient,
  olderThanDays: number,
  now: Date,
  limit: number,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminClient.rpc("list_expired_invoice_scan_objects", {
    p_before: cutoff,
    p_limit: limit,
  });

  throwIfSupabaseError(error);

  return ((data ?? []) as { name: string }[]).map((row) => row.name);
}

/** Borra las filas indicadas (cron con service role). Devuelve cuántas se borraron. */
export async function deleteScansByIds(adminClient: AdminClient, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const { data, error } = await adminClient
    .from("invoice_scans")
    .delete()
    .in("id", [...ids])
    .select("id");

  throwIfSupabaseError(error);

  return (data ?? []).length;
}
