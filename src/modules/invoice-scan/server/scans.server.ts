/**
 * Repositorio de `public.invoice_scans` contra Supabase (parche 20261019a).
 *
 * Las lecturas usan el cliente con el JWT del usuario: la RLS limita la tienda
 * de la sesión (`purchases.view`) y además cada consulta filtra por
 * `ctx.storeId`. authenticated no escribe la tabla (20261019g) ni ejecuta las
 * RPCs de escritura (20261019i): reserva, cierre, fallo y descarte van con el
 * cliente service role, y la tienda y el usuario son los de `ctx`, que el BFF
 * saca de la sesión tras `requireStorePermission`. La purga (cron) también
 * recibe el cliente service role. Paridad en `scans.mock-server.ts`.
 */
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { fetchAllRows, fetchAllRowsByIds } from "@/modules/reports/services/reportPagination";
import { caracasDateToUtcRange, getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

import type { InvoiceExtraction, InvoiceMatch, InvoiceScanLimits } from "../contracts";
import {
  type ExpiredScan,
  invoiceScanPagePaths,
  LIVE_INVOICE_SCAN_STATUSES,
  type LiveInvoiceScan,
  MAX_FEW_SHOT_EXAMPLES,
  parseConfirmedScan,
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
  confirmed: unknown;
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
  z.object({
    attemptId: z.string(),
    id: z.string(),
    limit: z.number(),
    outcome: z.literal("reserved"),
    used: z.number(),
  }),
]);

/**
 * Reserva atómica del escaneo (RPC `reserve_invoice_scan`, 20261019e/g/i): con
 * un lock por tienda decide caché, en curso, cuota o reserva, y en la reserva
 * deja la fila en `processing` con las páginas ya cobradas y un `attemptId`
 * nuevo. Solo service role: la tienda y el usuario son los de la sesión.
 */
export async function reserveScan(
  ctx: InvoiceScanContext,
  input: InvoiceScanReserveInput,
): Promise<InvoiceScanReservation> {
  const { data, error } = await createAdminSupabaseClient().rpc("reserve_invoice_scan", {
    p_limit: input.limit,
    p_model: input.model,
    p_pages: input.pages,
    p_provider: input.provider,
    p_sha256: input.imageSha256,
    p_storage_path: input.storagePath,
    p_store_id: ctx.storeId,
    p_user_id: ctx.userId,
  });

  throwIfSupabaseError(error);

  return reservationSchema.parse(data);
}

/**
 * Cierra el intento `attemptId` con la lectura (RPC `complete_invoice_scan`,
 * 20261019i). null si la fila ya no existe; 409 (PT409) si el intento ya no es
 * el vigente o no lo reservó este usuario.
 */
export async function completeScan(
  ctx: InvoiceScanContext,
  id: string,
  attemptId: string,
  completion: InvoiceScanCompletion,
): Promise<InvoiceScanRow | null> {
  const { data, error } = await createAdminSupabaseClient()
    .rpc("complete_invoice_scan", {
      p_attempt_id: attemptId,
      p_duration_ms: completion.durationMs,
      p_extracted: completion.extracted,
      p_id: id,
      p_input_tokens: completion.inputTokens,
      p_matched: completion.matched,
      p_output_tokens: completion.outputTokens,
      p_store_id: ctx.storeId,
      p_user_id: ctx.userId,
    })
    .select(scanSelect)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return data ? mapScan(data) : null;
}

/**
 * Cierra el intento `attemptId` sin lectura: `failed` con el código, nunca el
 * contenido (RPC `fail_invoice_scan`, 20261019i). Las páginas ya se cobraron;
 * con `refundPages` (fallo anterior a la llamada al modelo) se devuelven. 409
 * (PT409) si el intento ya no es el vigente.
 */
export async function failScan(
  ctx: InvoiceScanContext,
  id: string,
  attemptId: string,
  errorCode: string,
  refundPages = false,
): Promise<void> {
  const { error } = await createAdminSupabaseClient().rpc("fail_invoice_scan", {
    p_attempt_id: attemptId,
    p_error: errorCode,
    p_id: id,
    p_refund_pages: refundPages,
    p_store_id: ctx.storeId,
    p_user_id: ctx.userId,
  });

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
 * Número de la compra `purchaseId` de la tienda de la sesión (REP-01: enlace del
 * reescaneo de una factura ya confirmada); null si no es de la tienda o no se ve.
 */
export async function getPurchaseNumber(ctx: InvoiceScanContext, purchaseId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(purchaseId)) {
    return null;
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("purchases")
    .select("purchase_number")
    .eq("id", purchaseId)
    .eq("store_id", ctx.storeId)
    .maybeSingle<{ purchase_number: string | null }>();

  throwIfSupabaseError(error);

  return data?.purchase_number ?? null;
}

/**
 * Escaneo confirmado de la compra `purchaseId` (SCN-09a). `purchaseFound` es
 * false si la compra no es de la tienda de la sesión (la ruta responde 404);
 * `scan` es null si la compra no salió de un escaneo confirmado. Ambas
 * consultas van con el JWT del usuario y filtran por `ctx.storeId`.
 */
export async function findConfirmedScanByPurchase(
  ctx: InvoiceScanContext,
  purchaseId: string,
): Promise<{ purchaseFound: boolean; scan: InvoiceScanRow | null }> {
  if (!UUID_PATTERN.test(purchaseId)) {
    return { purchaseFound: false, scan: null };
  }

  const supabase = await createRouteSupabaseClient();
  const purchase = await supabase
    .from("purchases")
    .select("id")
    .eq("id", purchaseId)
    .eq("store_id", ctx.storeId)
    .maybeSingle<{ id: string }>();

  throwIfSupabaseError(purchase.error);

  if (!purchase.data) {
    return { purchaseFound: false, scan: null };
  }

  const { data, error } = await supabase
    .from("invoice_scans")
    .select(scanSelect)
    .eq("store_id", ctx.storeId)
    .eq("purchase_id", purchaseId)
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return { purchaseFound: true, scan: data ? mapScan(data) : null };
}

/**
 * Escaneo `processing`/`extracted`/`confirmed` de la tienda de la sesión con
 * ese hash (unique tienda + hash), o null. Va con service role para no depender
 * de `purchases.view`: `upload-url` la usa para no firmar subidas sobre los
 * objetos de un escaneo vivo (M3); solo devuelve id, estado y rutas.
 */
export async function findLiveScanByHash(
  ctx: InvoiceScanContext,
  sha256: string,
): Promise<LiveInvoiceScan | null> {
  const { data, error } = await createAdminSupabaseClient()
    .from("invoice_scans")
    .select("id, status, storage_path, pages")
    .eq("store_id", ctx.storeId)
    .eq("image_sha256", sha256)
    .in("status", [...LIVE_INVOICE_SCAN_STATUSES])
    .limit(1)
    .maybeSingle<{ id: string; status: LiveInvoiceScan["status"]; storage_path: string; pages: number }>();

  throwIfSupabaseError(error);

  return data
    ? { id: data.id, status: data.status, storagePaths: invoiceScanPagePaths(data.storage_path, data.pages) }
    : null;
}

/** Nombre de cada producto de la tienda de la sesión por id; los ajenos o borrados no salen. */
export async function getProductNames(
  ctx: InvoiceScanContext,
  productIds: readonly string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(productIds)].filter((id) => UUID_PATTERN.test(id));

  if (ids.length === 0) {
    return {};
  }

  const supabase = await createRouteSupabaseClient();
  // REP6-05: hasta 300 líneas; los ids van por lotes para que el filtro `in` quepa en la URL.
  const rows = await fetchAllRowsByIds<{ id: string; name: string }>(ids, (chunk, from, to) =>
    supabase.from("products").select("id, name").eq("store_id", ctx.storeId).in("id", chunk).order("id").range(from, to),
  );

  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

/**
 * Descarta un escaneo `extracted` (RPC `discard_invoice_scan`, 20261019g/i,
 * solo service role, con la tienda de la sesión). null si no es de la tienda
 * (404); en otro estado la RPC responde PT409 con el mensaje de ese estado
 * (`DISCARD_NOT_ALLOWED_MESSAGES`).
 */
export async function discardScan(
  ctx: InvoiceScanContext,
  id: string,
): Promise<InvoiceScanRow | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const { data, error } = await createAdminSupabaseClient()
    .rpc("discard_invoice_scan", { p_id: id, p_store_id: ctx.storeId })
    .select(scanSelect)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return data ? mapScan(data) : null;
}

/**
 * Páginas cobradas hoy (día operativo de Caracas) por la tienda: suma de
 * `usage_pages`, que cuenta cada intento (fallidos y reescaneos incluidos).
 *
 * Limitación aceptada (caos-2 N9, parche 20261019g): al reutilizar una fila de
 * otro día, `reserve_invoice_scan` la pasa a hoy con solo el intento nuevo, así
 * que el consumo de aquel día pierde esas páginas. La cuota de hoy es correcta.
 */
export async function getDailyUsage(
  ctx: InvoiceScanContext,
  limit: number,
  now: Date = new Date(),
): Promise<InvoiceScanLimits> {
  const { endUtcExclusive, startUtc } = caracasDateToUtcRange(getCaracasIsoDate(now));
  const supabase = await createRouteSupabaseClient();
  // REP6-05: con un límite diario de hasta 10.000 páginas el día puede pasar de 1000 filas.
  const rows = await fetchAllRows<{ usage_pages: number }>((from, to) =>
    supabase
      .from("invoice_scans")
      .select("usage_pages")
      .eq("store_id", ctx.storeId)
      .gte("created_at", startUtc)
      .lt("created_at", endUtcExclusive)
      .order("id")
      .range(from, to),
  );

  const used = rows.reduce((sum, row) => sum + row.usage_pages, 0);

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

  return ((data ?? []) as { id: string; storage_path: string; confirmed: unknown }[]).flatMap((row) => {
    const confirmed = parseConfirmedScan(row.confirmed);

    return confirmed ? [{ extraction: confirmed.extraction, scanId: row.id, storagePath: row.storage_path }] : [];
  });
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
