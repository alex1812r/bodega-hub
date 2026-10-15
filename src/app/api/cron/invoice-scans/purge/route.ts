import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireCronSecret } from "@/lib/api/requireCronSecret";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import * as mock from "@/modules/invoice-scan/server/scans.mock-server";
import * as server from "@/modules/invoice-scan/server/scans.server";
import { type ExpiredScan, INVOICE_SCAN_RETENTION_DAYS } from "@/modules/invoice-scan/server/scans.types";
import { removeInvoiceObjects } from "@/modules/invoice-scan/server/storage";

/** Escaneos por lote: acota la URL del `.in("id", …)` y el cuerpo del `remove()` de Storage. */
const PURGE_BATCH_SIZE = 100;
/** Lotes por corrida: lo que quede se purga en la siguiente. */
const PURGE_MAX_BATCHES = 20;

type PurgeSteps = {
  list: (limit: number) => Promise<ExpiredScan[]>;
  removeObjects: (paths: string[]) => Promise<void>;
  deleteRows: (ids: string[]) => Promise<number>;
};

async function purgeInBatches(steps: PurgeSteps) {
  const totals = { deleted: 0, objects: 0 };

  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    const expired = await steps.list(PURGE_BATCH_SIZE);
    if (expired.length === 0) {
      break;
    }

    const objectPaths = expired.flatMap((scan) => scan.storagePaths);
    // Primero Storage: si falla, las filas del lote se conservan y la próxima
    // corrida reintenta, en vez de dejar imágenes huérfanas sin referencia.
    try {
      await steps.removeObjects(objectPaths);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(error.status, error.code, error.message, totals);
      }
      throw error;
    }
    totals.deleted += await steps.deleteRows(expired.map((scan) => scan.id));
    totals.objects += objectPaths.length;

    if (expired.length < PURGE_BATCH_SIZE) {
      break;
    }
  }

  return totals;
}

function purgeSupabase(now: Date) {
  const admin = createAdminSupabaseClient();

  return purgeInBatches({
    deleteRows: (ids) => server.deleteScansByIds(admin, ids),
    list: (limit) => server.listExpiredScans(admin, INVOICE_SCAN_RETENTION_DAYS, now, limit),
    removeObjects: (paths) => removeInvoiceObjects(admin, paths),
  });
}

function purgeMock(now: Date) {
  return purgeInBatches({
    deleteRows: (ids) => mock.deleteScansByIds(null, ids),
    list: (limit) => mock.listExpiredScans(null, INVOICE_SCAN_RETENTION_DAYS, now, limit),
    // El mock no guarda objetos en Storage.
    removeObjects: async () => undefined,
  });
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
