import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireCronSecret } from "@/lib/api/requireCronSecret";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import * as mock from "@/modules/invoice-scan/server/scans.mock-server";
import * as server from "@/modules/invoice-scan/server/scans.server";
import { INVOICE_SCAN_RETENTION_DAYS } from "@/modules/invoice-scan/server/scans.types";
import {
  INVOICE_SCANS_BUCKET,
  INVOICE_STORAGE_UNAVAILABLE_MESSAGE,
  removeInvoiceObjects,
} from "@/modules/invoice-scan/server/storage";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Todas las rutas de Storage de los escaneos vencidos. `storage_path` es la
 * página 1 (`<store>/<sha>/p1.<ext>`); las demás páginas comparten la carpeta
 * `<store>/<sha>/` pero cada una puede tener otra extensión, así que se lista
 * la carpeta en vez de adivinar los nombres.
 */
async function listExpiredObjectPaths(admin: AdminClient, now: Date): Promise<string[]> {
  const cutoff = new Date(now.getTime() - INVOICE_SCAN_RETENTION_DAYS * DAY_MS).toISOString();
  const { data, error } = await admin
    .from("invoice_scans")
    .select("storage_path")
    .lt("created_at", cutoff);

  throwIfSupabaseError(error);

  const folders = new Set(
    ((data ?? []) as { storage_path: string }[]).map((row) =>
      row.storage_path.slice(0, row.storage_path.lastIndexOf("/")),
    ),
  );
  const bucket = admin.storage.from(INVOICE_SCANS_BUCKET);
  const paths = await Promise.all(
    [...folders].map(async (folder) => {
      const result = await bucket.list(folder).catch(() => null);

      if (!result || result.error) {
        throw new ApiError(503, "INTERNAL_ERROR", INVOICE_STORAGE_UNAVAILABLE_MESSAGE);
      }

      return (result.data ?? []).map((object) => `${folder}/${object.name}`);
    }),
  );

  return paths.flat();
}

async function purgeSupabase(now: Date) {
  const admin = createAdminSupabaseClient();
  const objectPaths = await listExpiredObjectPaths(admin, now);

  // Primero Storage: si falla, las filas se conservan y la próxima corrida
  // reintenta, en vez de dejar imágenes huérfanas sin referencia.
  await removeInvoiceObjects(admin, objectPaths);
  const { deletedIds } = await server.purgeExpiredScans(admin, INVOICE_SCAN_RETENTION_DAYS, now);

  return { deleted: deletedIds.length, objects: objectPaths.length };
}

async function purgeMock(now: Date) {
  const { deletedIds, storagePaths } = await mock.purgeExpiredScans(
    null,
    INVOICE_SCAN_RETENTION_DAYS,
    now,
  );

  return { deleted: deletedIds.length, objects: storagePaths.length };
}

async function handle(request: Request) {
  try {
    requireCronSecret(request);
    const now = new Date();
    const result = resolveDataSource() === "supabase" ? await purgeSupabase(now) : await purgeMock(now);
    return jsonData(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
