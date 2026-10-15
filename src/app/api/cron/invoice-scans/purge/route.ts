import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireCronSecret } from "@/lib/api/requireCronSecret";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import * as mock from "@/modules/invoice-scan/server/scans.mock-server";
import * as server from "@/modules/invoice-scan/server/scans.server";
import { INVOICE_SCAN_RETENTION_DAYS } from "@/modules/invoice-scan/server/scans.types";
import { removeInvoiceObjects } from "@/modules/invoice-scan/server/storage";

async function purgeSupabase(now: Date) {
  const admin = createAdminSupabaseClient();
  const expired = await server.listExpiredScans(admin, INVOICE_SCAN_RETENTION_DAYS, now);
  const objectPaths = expired.flatMap((scan) => scan.storagePaths);

  // Primero Storage: si falla, las filas se conservan y la próxima corrida
  // reintenta, en vez de dejar imágenes huérfanas sin referencia.
  await removeInvoiceObjects(admin, objectPaths);
  const deleted = await server.deleteScansByIds(
    admin,
    expired.map((scan) => scan.id),
  );

  return { deleted, objects: objectPaths.length };
}

async function purgeMock(now: Date) {
  const expired = await mock.listExpiredScans(null, INVOICE_SCAN_RETENTION_DAYS, now);
  const deleted = await mock.deleteScansByIds(
    null,
    expired.map((scan) => scan.id),
  );

  return { deleted, objects: expired.flatMap((scan) => scan.storagePaths).length };
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
