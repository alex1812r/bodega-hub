import type { ZodIssue } from "zod";

import { PRODUCT_IMPORT_HEADERS } from "../schemas/productImportRowSchema";
import type { ProductImportValidatedRow } from "../types";

const LOG_PREFIX = "[ProductImport]";

export function isProductImportValidationLoggingEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_PRODUCT_IMPORT_DEBUG === "true") {
    return true;
  }

  return process.env.NODE_ENV === "development";
}

export type ProductImportRowLogPayload = {
  availableCategories?: string[];
  categoryInput?: string;
  messages: string[];
  name: string;
  parsedValues: Record<string, unknown>;
  rawCells: Record<string, string>;
  rowIndex: number;
  sku: string;
  status: ProductImportValidatedRow["status"];
  zodIssues?: Array<{
    code: string;
    message: string;
    path: string;
    received?: unknown;
  }>;
};

export function rawCellsFromExcelRow(row: unknown[]): Record<string, string> {
  const cells: Record<string, string> = {};

  PRODUCT_IMPORT_HEADERS.forEach((header, index) => {
    const value = row[index];
    const text = value === null || value === undefined ? "" : String(value).trim();
    const type =
      value === null || value === undefined || value === ""
        ? "vacío"
        : typeof value === "number"
          ? "número"
          : "texto";

    cells[header] = text === "" ? `(vacío, ${type})` : `${text} (${type})`;
  });

  return cells;
}

export function formatZodIssuesForLog(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.join(".") || "(raíz)",
    code: issue.code,
    message: issue.message,
    received: "received" in issue ? issue.received : undefined,
  }));
}

export function logProductImportRowValidation(payload: ProductImportRowLogPayload): void {
  if (!isProductImportValidationLoggingEnabled()) {
    return;
  }

  if (payload.status === "valid") {
    return;
  }

  const level = payload.status === "error" ? "error" : "warn";
  const label = `${LOG_PREFIX} Fila ${payload.rowIndex} · ${payload.status.toUpperCase()} · SKU "${payload.sku}"`;

  console.groupCollapsed(label);
  console[level]("Motivo(s):", payload.messages);
  console.log("Celdas leídas del Excel:", payload.rawCells);
  console.log("Valores después de interpretar:", payload.parsedValues);

  if (payload.zodIssues && payload.zodIssues.length > 0) {
    console.table(payload.zodIssues);
  }

  if (payload.categoryInput !== undefined) {
    console.log("Categoría en archivo:", payload.categoryInput || "(vacía)");
  }

  if (payload.availableCategories && payload.availableCategories.length > 0) {
    console.log("Categorías permitidas en plantilla:", payload.availableCategories);
  }

  console.groupEnd();
}

export type ProductImportParseSummaryPayload = {
  categoriesLoaded: number;
  fileName?: string;
  rows: ProductImportValidatedRow[];
};

export function logProductImportParseSummary(payload: ProductImportParseSummaryPayload): void {
  if (!isProductImportValidationLoggingEnabled()) {
    return;
  }

  const valid = payload.rows.filter((row) => row.status === "valid").length;
  const warning = payload.rows.filter((row) => row.status === "warning").length;
  const error = payload.rows.filter((row) => row.status === "error").length;
  const importable = payload.rows.filter(
    (row) => row.status !== "error" && row.input,
  ).length;

  const errorRows = payload.rows
    .filter((row) => row.status === "error")
    .map((row) => ({
      fila: row.rowIndex,
      sku: row.sku,
      nombre: row.name,
      motivos: row.messages.join(" | "),
    }));

  const warningRows = payload.rows
    .filter((row) => row.status === "warning")
    .map((row) => ({
      fila: row.rowIndex,
      sku: row.sku,
      motivos: row.messages.join(" | "),
    }));

  console.group(`${LOG_PREFIX} Resumen paso 3 (preview)`);
  console.info("Archivo:", payload.fileName ?? "(sin nombre)");
  console.info("Categorías cargadas para validar:", payload.categoriesLoaded);
  console.info("Filas:", {
    total: payload.rows.length,
    validas: valid,
    advertencias: warning,
    errores: error,
    importables: importable,
  });

  if (errorRows.length > 0) {
    console.error("Filas con error (no se importarán):");
    console.table(errorRows);
    console.info(
      "Tip: expande los grupos «Fila N · ERROR» arriba en la consola para ver celdas Excel y validación Zod.",
    );
  }

  if (warningRows.length > 0) {
    console.warn("Filas con advertencia (sí se pueden importar):");
    console.table(warningRows);
  }

  console.groupEnd();
}
