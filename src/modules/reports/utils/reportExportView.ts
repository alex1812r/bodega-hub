import type { z } from "zod";

import type { ReportViewer } from "../reports-list/config/reportAccess";
import { reportsListSchema } from "../reports-list/reportsListParams";
import {
  DEAD_STOCK_MAX_DAYS,
  STOCK_TURNOVER_GROUP_BY_VALUES,
  type StockTurnoverGroupBy,
} from "../services/inventoryReports";
import type { AgingBucket, CashCloseCurrency } from "../services/moneyReports";
import {
  PURCHASE_REPORT_STATUS_ALL,
  PURCHASE_REPORT_STATUSES,
  type PurchasesReportStatusFilter,
  type ReportGroupBy,
} from "../services/reportSeries";

/**
 * Lo que el usuario tiene en pantalla en `/reports` al exportar: reporte activo
 * y sus filtros propios. Sale de la URL (regla 15), no de props: así el
 * encabezado, el nombre del archivo y la imagen del gráfico cuadran con lo que
 * se ve. Plataforma (`scope`) no lo usa.
 */
export type ReportsExportView = {
  /** Id del reporte abierto (`?report=`). */
  activeReportId: string;
  /** Tramo de antigüedad (cuentas por cobrar / pagar). */
  bucket?: AgingBucket;
  /** Categoría (productos sin movimiento). */
  categoryId?: string;
  /** «Comparar con periodo anterior» activo. */
  compare: boolean;
  /** Contacto (cuentas por cobrar / pagar). */
  contactId?: string;
  /** Moneda (diferencias de cierre de caja). */
  currency?: CashCloseCurrency;
  /** Días sin movimiento (productos sin movimiento). */
  days?: number;
  /** Agrupación elegida; sin valor = automática. */
  groupBy?: ReportGroupBy;
  /** Estado de compras (reporte de compras). */
  purchasesStatus?: PurchasesReportStatusFilter;
  /** Rotación por producto o por categoría. */
  turnoverGroupBy?: StockTurnoverGroupBy;
  /** Sesión: decide qué reportes con permiso propio entran en el archivo. */
  viewer: ReportViewer;
};

/** Tope de texto de un id que llega por la URL. */
const URL_ID_MAX_LENGTH = 120;

/** Parámetro de la agrupación de «Rotación de inventario» (`groupBy` ya es día, semana o mes). */
const TURNOVER_GROUP_BY_PARAM = "turnoverBy";

function readSchemaField<TField extends z.ZodType>(
  field: TField,
  raw: string | null,
): z.output<TField> | undefined {
  const parsed = field.safeParse(raw ?? undefined);

  return parsed.success ? parsed.data : undefined;
}

function readText(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim() ?? "";

  return value !== "" && value.length <= URL_ID_MAX_LENGTH ? value : undefined;
}

function readDays(params: URLSearchParams) {
  const raw = params.get("days")?.trim() ?? "";

  if (!/^\d{1,5}$/.test(raw)) {
    return undefined;
  }

  const days = Number(raw);

  return days >= 1 && days <= DEAD_STOCK_MAX_DAYS ? days : undefined;
}

function readPurchasesStatus(params: URLSearchParams): PurchasesReportStatusFilter | undefined {
  const raw = params.get("status")?.trim() ?? "";
  const allowed: readonly string[] = [...PURCHASE_REPORT_STATUSES, PURCHASE_REPORT_STATUS_ALL];

  return allowed.includes(raw) ? (raw as PurchasesReportStatusFilter) : undefined;
}

function readTurnoverGroupBy(params: URLSearchParams): StockTurnoverGroupBy | undefined {
  const raw = params.get(TURNOVER_GROUP_BY_PARAM)?.trim() ?? "";

  return (STOCK_TURNOVER_GROUP_BY_VALUES as readonly string[]).includes(raw)
    ? (raw as StockTurnoverGroupBy)
    : undefined;
}

/**
 * Query de `/reports` (`window.location.search`) → vista a exportar. Tolerante:
 * un parámetro ausente o inválido se ignora (como hace `useUrlListState`).
 * `status`, `days`, `categoryId` y `turnoverBy` se validan aquí con las mismas
 * reglas que su ruta, sin depender de que el esquema de la URL los declare.
 */
export function readReportsExportView(search: string, viewer: ReportViewer): ReportsExportView {
  const params = new URLSearchParams(search);
  const shape = reportsListSchema.shape;
  const activeReportId =
    readSchemaField(shape.report, params.get("report")) ?? shape.report.parse(undefined);

  return {
    activeReportId,
    bucket: readSchemaField(shape.bucket, params.get("bucket")) || undefined,
    categoryId: readText(params, "categoryId"),
    compare: readSchemaField(shape.compare, params.get("compare")) === "1",
    contactId: readSchemaField(shape.contactId, params.get("contactId")) || undefined,
    currency: readSchemaField(shape.currency, params.get("currency")) || undefined,
    days: readDays(params),
    groupBy: readSchemaField(shape.groupBy, params.get("groupBy")) || undefined,
    purchasesStatus: readPurchasesStatus(params),
    turnoverGroupBy: readTurnoverGroupBy(params),
    viewer,
  };
}

/**
 * La vista, solo si `reportId` es el reporte abierto: tramo, contacto, moneda,
 * días y categoría son del reporte activo y no se aplican a las demás hojas.
 */
export function getActiveExportView(view: ReportsExportView | undefined, reportId: string) {
  return view && view.activeReportId === reportId ? view : undefined;
}
