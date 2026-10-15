/**
 * Repositorio de `public.invoice_scans` contra Supabase (parche 20261015c).
 *
 * Usa el cliente con el JWT del usuario: la RLS limita a la tienda de la sesión
 * (lee `purchases.view`, escribe `purchases.create`) y además cada consulta
 * filtra por `ctx.storeId`. Solo la purga (cron) recibe el cliente service role.
 * Paridad en `scans.mock-server.ts`.
 */
import { ApiError } from "@/lib/api/apiError";
import type { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { caracasDateToUtcRange, getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

import type { InvoiceExtraction, InvoiceMatch, InvoiceScanLimits } from "../contracts";
import {
  DISCARD_NOT_ALLOWED_MESSAGE,
  INVOICE_SCAN_RETENTION_DAYS,
  MAX_FEW_SHOT_EXAMPLES,
  type InvoiceFewShotExample,
  type InvoiceScanContext,
  type InvoiceScanInsert,
  type InvoiceScanRow,
  type InvoiceScanStatus,
  type PurgeExpiredScansResult,
} from "./scans.types";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type DbInvoiceScanRow = {
  id: string;
  store_id: string;
  created_by: string;
  image_sha256: string;
  storage_path: string;
  pages: number;
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
  "id, store_id, created_by, image_sha256, storage_path, pages, provider, model, input_tokens, output_tokens, duration_ms, extracted, matched, confirmed, purchase_id, supplier_id, status, error, created_at, confirmed_at";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

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
  };
}

function toDbWrite(ctx: InvoiceScanContext, input: InvoiceScanInsert) {
  return {
    created_by: ctx.userId,
    duration_ms: input.durationMs ?? null,
    error: input.error ?? null,
    extracted: input.extracted ?? {},
    image_sha256: input.imageSha256,
    input_tokens: input.inputTokens ?? null,
    matched: input.matched ?? {},
    model: input.model,
    output_tokens: input.outputTokens ?? null,
    pages: input.pages ?? 1,
    provider: input.provider,
    status: input.status ?? "extracted",
    storage_path: input.storagePath,
    store_id: ctx.storeId,
  };
}

async function selectByHash(ctx: InvoiceScanContext, sha256: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .select(scanSelect)
    .eq("store_id", ctx.storeId)
    .eq("image_sha256", sha256)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return data ? mapScan(data) : null;
}

/** Caché por hash: un escaneo `failed` no cuenta (se reintenta). */
export async function findScanByHash(
  ctx: InvoiceScanContext,
  sha256: string,
): Promise<InvoiceScanRow | null> {
  const scan = await selectByHash(ctx, sha256);

  return scan && scan.status !== "failed" ? scan : null;
}

/**
 * Registra un escaneo. Si la tienda ya tiene una fila `failed` con el mismo
 * hash (unique store_id + image_sha256) la reutiliza: la sobrescribe con este
 * intento y le pone `created_at = now()`, así el reintento cuenta en la cuota
 * de hoy. Si otra petición ganó la carrera con el mismo hash, devuelve su fila.
 */
export async function insertScan(
  ctx: InvoiceScanContext,
  input: InvoiceScanInsert,
): Promise<InvoiceScanRow> {
  const existing = await selectByHash(ctx, input.imageSha256);

  if (existing && existing.status !== "failed") {
    return existing;
  }

  const supabase = await createRouteSupabaseClient();

  if (existing) {
    const { data, error } = await supabase
      .from("invoice_scans")
      .update({ ...toDbWrite(ctx, input), created_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("store_id", ctx.storeId)
      .eq("status", "failed")
      .select(scanSelect)
      .maybeSingle<DbInvoiceScanRow>();

    throwIfSupabaseError(error);

    return data ? mapScan(data) : ((await selectByHash(ctx, input.imageSha256)) ?? existing);
  }

  const { data, error } = await supabase
    .from("invoice_scans")
    .insert(toDbWrite(ctx, input))
    .select(scanSelect)
    .single<DbInvoiceScanRow>();

  if (error?.code === UNIQUE_VIOLATION) {
    const winner = await selectByHash(ctx, input.imageSha256);

    if (winner) {
      return winner;
    }
  }

  throwIfSupabaseError(error);

  return mapScan(data as DbInvoiceScanRow);
}

/** Marca como fallido un escaneo aún sin confirmar. null si no existe en la tienda o ya no está `extracted`. */
export async function markScanFailed(
  ctx: InvoiceScanContext,
  id: string,
  errorMessage: string,
): Promise<InvoiceScanRow | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .update({ error: errorMessage, status: "failed" })
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .eq("status", "extracted")
    .select(scanSelect)
    .maybeSingle<DbInvoiceScanRow>();

  throwIfSupabaseError(error);

  return data ? mapScan(data) : null;
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

/** Páginas escaneadas hoy (día operativo de Caracas) por la tienda, fallidos incluidos. */
export async function getDailyUsage(
  ctx: InvoiceScanContext,
  limit: number,
  now: Date = new Date(),
): Promise<InvoiceScanLimits> {
  const { endUtcExclusive, startUtc } = caracasDateToUtcRange(getCaracasIsoDate(now));
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("invoice_scans")
    .select("pages")
    .eq("store_id", ctx.storeId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtcExclusive);

  throwIfSupabaseError(error);

  const used = ((data ?? []) as { pages: number }[]).reduce((sum, row) => sum + row.pages, 0);

  return { limit, remaining: Math.max(0, limit - used), used };
}

/** Hasta `max` (≤ 3) escaneos confirmados del proveedor, del más reciente al más antiguo. */
export async function listFewShotExamples(
  ctx: InvoiceScanContext,
  supplierId: string,
  max: number = MAX_FEW_SHOT_EXAMPLES,
): Promise<InvoiceFewShotExample[]> {
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
 * Borra los escaneos de todas las tiendas creados hace más de `olderThanDays`
 * días (cron con service role). Devuelve las rutas de Storage para que el
 * llamador borre las imágenes.
 */
export async function purgeExpiredScans(
  adminClient: AdminClient,
  olderThanDays: number = INVOICE_SCAN_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<PurgeExpiredScansResult> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminClient
    .from("invoice_scans")
    .delete()
    .lt("created_at", cutoff)
    .select("id, storage_path");

  throwIfSupabaseError(error);

  const rows = (data ?? []) as { id: string; storage_path: string }[];

  return {
    deletedIds: rows.map((row) => row.id),
    storagePaths: rows.map((row) => row.storage_path),
  };
}
