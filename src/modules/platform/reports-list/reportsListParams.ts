import { z } from "zod";

import type {
  PurchasesReportFilters,
  ReportDateRangeFilters,
  ReportRequestScope,
  StockCardReportFilters,
} from "@/modules/reports/hooks/useReports";
import {
  MULTI_STORE_REPORT_IDS,
  type MultiStoreReportId,
  type ReportId,
} from "@/modules/reports/reports-list/config/reportCatalog";
import { DATE_RANGE_PRESETS } from "@/shared/components/DateRangeField";
import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { PlatformStoreScope } from "../types/reports";

/**
 * Reportes que la URL puede dejar activos: los multi-tienda del catálogo. Los de
 * la tienda activa (dinero, inventario) no existen en `/api/platform/reports`.
 */
export const PLATFORM_REPORT_IDS = MULTI_STORE_REPORT_IDS;

/** Reporte de plataforma cuando la URL no trae `report` (o trae uno que no existe aquí). */
export const DEFAULT_PLATFORM_REPORT_ID: MultiStoreReportId = "daily-sales";

export function isPlatformReportId(id: ReportId | string): id is MultiStoreReportId {
  return (PLATFORM_REPORT_IDS as readonly string[]).includes(id);
}

export const PLATFORM_STORE_SCOPES = [
  "all",
  "one",
  "selected",
] as const satisfies readonly PlatformStoreScope[];

/** Campos de texto de la pantalla: se escriben en la URL con debounce. */
export const PLATFORM_REPORTS_TEXT_FIELDS = ["supplier", "product"] as const;

/** Máximo de tiendas que ofrece el selector de alcance. */
const MAX_SCOPE_STORES = 100;
/** Un id de tienda es un UUID; cualquier otra cosa en la URL se ignora y no viaja al servidor. */
const STORE_ID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Estado de `/platform/reports` en la URL (regla 15). Sin parámetros = reporte
 * por defecto, todas las tiendas, sin filtros. La pantalla no pagina ni ordena.
 *
 * | Parámetro     | Valores                                                 | Por defecto   |
 * |---------------|---------------------------------------------------------|---------------|
 * | `report`      | id del catálogo de reportes                             | `daily-sales` |
 * | `from` / `to` | `YYYY-MM-DD`, día operativo Caracas                     | `""`          |
 * | `preset`      | preset de `DateRangeField` (relativo: se recalcula)     | `""`          |
 * | `supplier`    | id del proveedor (texto, con debounce)                  | `""`          |
 * | `product`     | id del producto (texto, con debounce)                   | `""`          |
 * | `scope`       | `all` · `one` · `selected`                              | `all`         |
 * | `store`       | id (UUID) de tienda, repetible: `?store=a&store=b`      | ninguna       |
 */
export const platformReportsListSchema = z.object({
  report: listParams.oneOf(PLATFORM_REPORT_IDS, DEFAULT_PLATFORM_REPORT_ID),
  from: listParams.date(),
  to: listParams.date(),
  preset: listParams.oneOf(["", ...DATE_RANGE_PRESETS], ""),
  supplier: listParams.text(),
  product: listParams.text(),
  scope: listParams.oneOf(PLATFORM_STORE_SCOPES, "all"),
  store: z.array(z.string().regex(STORE_ID_PARAM)).max(MAX_SCOPE_STORES).default([]),
});

export type PlatformReportsListState = UrlListStateOf<typeof platformReportsListSchema.shape>;

/**
 * Tiendas que cuentan para el alcance elegido, venga lo que venga en la URL:
 * `all` no lleva ninguna, `one` solo la primera y `selected` todas, sin repetir.
 */
export function toSelectedStoreIds(
  state: Pick<PlatformReportsListState, "scope" | "store">,
): string[] {
  if (state.scope === "all") {
    return [];
  }

  const unique = [...new Set(state.store)];

  return state.scope === "one" ? unique.slice(0, 1) : unique;
}

/** `enabled` es `false` mientras el alcance pida tiendas y no haya ninguna elegida. */
export function toPlatformReportScope(
  state: Pick<PlatformReportsListState, "scope" | "store">,
): ReportRequestScope & { enabled: boolean } {
  const storeIds = toSelectedStoreIds(state);

  return {
    enabled: state.scope === "all" || storeIds.length > 0,
    pathPrefix: "/api/platform/reports",
    storeIds: storeIds.join(","),
    storeScope: state.scope,
  };
}

/**
 * Rango ya resuelto (`parseDateRangeParams`, nunca `state.from/to`: un `preset`
 * relativo no trae fechas) → filtros de los reportes. `supplier` y `product`
 * llegan ya con su debounce. El rango vale también para el reporte de compras.
 */
export function toPlatformReportFilters(
  range: { from?: string; to?: string },
  supplier: string,
  product: string,
): {
  dateFilters: ReportDateRangeFilters;
  purchasesFilters: PurchasesReportFilters;
  stockCardFilters: StockCardReportFilters;
} {
  const dateFilters = { from: range.from || undefined, to: range.to || undefined };

  return {
    dateFilters,
    purchasesFilters: { ...dateFilters, supplierId: supplier.trim() || undefined },
    stockCardFilters: { productId: product.trim() || undefined },
  };
}
