import * as XLSX from "xlsx";

import type { CategoryMock } from "@/shared/mocks/erp-data";

import {
  PRODUCT_IMPORT_HEADERS,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_SHEET,
} from "../schemas/productImportRowSchema";
import type { ProductImportRawRow, ProductImportValidatedRow } from "../types";
import {
  formatZodIssuesForLog,
  logProductImportRowValidation,
  rawCellsFromExcelRow,
} from "./logProductImportValidation";
import { revalidateProductImportRows } from "./validateProductImportRows";

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : NaN;
}

function cellToString(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function isRowEmpty(values: unknown[]) {
  return values.every((value) => cellToString(value) === "");
}

function headersMatch(row: unknown[]) {
  return PRODUCT_IMPORT_HEADERS.every((header, index) => {
    return cellToString(row[index]).toLowerCase() === header;
  });
}

function toRawRow(rowIndex: number, values: unknown[]): ProductImportRawRow {
  return {
    rowIndex,
    sku: cellToString(values[0]),
    codigo_barras: cellToString(values[1]) || undefined,
    nombre: cellToString(values[2]),
    categoria: cellToString(values[3]) || undefined,
    precio_ref: parseNumber(values[4]) ?? NaN,
    costo_ref: parseNumber(values[5]),
    stock_inicial: parseNumber(values[6]),
    stock_minimo: parseNumber(values[7]),
  };
}

export function parseProductImportWorkbook(
  buffer: ArrayBuffer,
  categories: CategoryMock[],
  existingSkus: Set<string> = new Set(),
): ProductImportValidatedRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[PRODUCT_IMPORT_SHEET];

  if (!sheet) {
    throw new Error(`No se encontro la hoja "${PRODUCT_IMPORT_SHEET}".`);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error("El archivo esta vacio.");
  }

  if (!headersMatch(rows[0] ?? [])) {
    throw new Error(
      `Encabezados invalidos. Use exactamente: ${PRODUCT_IMPORT_HEADERS.join(", ")}`,
    );
  }

  const dataRows = rows.slice(2).filter((row) => !isRowEmpty(row));

  if (dataRows.length === 0) {
    throw new Error("No hay filas de datos para importar (desde fila 3).");
  }

  if (dataRows.length > PRODUCT_IMPORT_MAX_ROWS) {
    throw new Error(`Maximo ${PRODUCT_IMPORT_MAX_ROWS} filas de datos por archivo.`);
  }

  const rawRows = dataRows.map((row, index) => toRawRow(index + 3, row));
  const categoryNames = categories.map((category) => category.name);

  const validated = revalidateProductImportRows(rawRows, {
    categories,
    existingSkus,
  });

  validated.forEach((validatedRow, index) => {
    const raw = rawRows[index];
    const excelRow = dataRows[index] ?? [];

    if (validatedRow.status === "valid") {
      return;
    }

    logProductImportRowValidation({
      availableCategories: categoryNames,
      categoryInput: raw.categoria,
      messages: validatedRow.messages,
      name: validatedRow.name,
      parsedValues: {
        sku: raw.sku,
        nombre: raw.nombre,
        categoria: raw.categoria ?? null,
        precio_ref: raw.precio_ref,
        precio_ref_valido: !Number.isNaN(raw.precio_ref),
        costo_ref: raw.costo_ref ?? null,
        costo_ref_valido:
          raw.costo_ref === undefined ? "sin valor" : !Number.isNaN(raw.costo_ref),
        stock_inicial: raw.stock_inicial ?? null,
        stock_inicial_valido:
          raw.stock_inicial === undefined ? "sin valor" : !Number.isNaN(raw.stock_inicial),
        stock_minimo: raw.stock_minimo ?? null,
        stock_minimo_valido:
          raw.stock_minimo === undefined ? "sin valor" : !Number.isNaN(raw.stock_minimo),
      },
      rawCells: rawCellsFromExcelRow(excelRow),
      rowIndex: validatedRow.rowIndex,
      sku: validatedRow.sku,
      status: validatedRow.status,
    });
  });

  return validated;
}
