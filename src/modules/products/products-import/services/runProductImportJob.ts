import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";
import type { ProductMock } from "@/shared/mocks/erp-data";

import type {
  ProductImportJobOptions,
  ProductImportProgress,
  ProductImportRowResult,
} from "../types";

export async function runProductImportJob(
  options: ProductImportJobOptions,
): Promise<ProductImportRowResult[]> {
  const importableRows = options.rows.filter(
    (row) => row.status !== "error" && row.input,
  );

  const results: ProductImportRowResult[] = [];
  const progress: ProductImportProgress = {
    total: importableRows.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
  };

  options.onProgress?.(progress);

  for (const row of importableRows) {
    if (options.signal?.aborted) {
      break;
    }

    progress.currentRow = row;
    options.onProgress?.({ ...progress });

    if (!row.input) {
      results.push({
        rowIndex: row.rowIndex,
        sku: row.sku,
        status: "skipped",
        error: "Fila sin datos validos.",
      });
      progress.processed += 1;
      progress.failed += 1;
      options.onProgress?.({ ...progress, currentRow: undefined });
      continue;
    }

    try {
      await apiFetch<ProductMock>("/api/products", {
        body: row.input,
        method: "POST",
        signal: options.signal,
      });

      results.push({
        rowIndex: row.rowIndex,
        sku: row.sku,
        status: "success",
      });
      progress.succeeded += 1;
    } catch (error) {
      const message =
        error instanceof ClientApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Error desconocido.";

      results.push({
        rowIndex: row.rowIndex,
        sku: row.sku,
        status: "failed",
        error: message,
      });
      progress.failed += 1;

      if (options.onError === "stop") {
        progress.processed += 1;
        options.onProgress?.({ ...progress, currentRow: undefined });
        break;
      }
    }

    progress.processed += 1;
    options.onProgress?.({ ...progress, currentRow: undefined });
  }

  return results;
}
