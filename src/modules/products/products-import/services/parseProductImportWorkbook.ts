import * as XLSX from "xlsx";

import type { CategoryMock } from "@/shared/mocks/erp-data";

import type { ProductInput } from "../../hooks/useProducts";
import {
  PRODUCT_IMPORT_HEADERS,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_SHEET,
  productImportRowSchema,
} from "../schemas/productImportRowSchema";
import type { ProductImportRawRow, ProductImportValidatedRow } from "../types";
import { resolveCategoryIdByName } from "./resolveCategoryIds";

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
    nombre: cellToString(values[1]),
    categoria: cellToString(values[2]) || undefined,
    precio_ref: parseNumber(values[3]) ?? NaN,
    costo_ref: parseNumber(values[4]),
    stock_inicial: parseNumber(values[5]),
    stock_minimo: parseNumber(values[6]),
  };
}

function toProductInput(
  parsed: ReturnType<typeof productImportRowSchema.parse>,
  categoryId?: string,
): ProductInput {
  return {
    sku: parsed.sku,
    name: parsed.nombre,
    categoryId,
    salePriceRef: parsed.precio_ref,
    currentCostRef: parsed.costo_ref ?? 0,
    currentStock: parsed.stock_inicial ?? 0,
    minStock: parsed.stock_minimo ?? 5,
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

  const skuInFile = new Map<string, number>();
  const validated: ProductImportValidatedRow[] = [];

  dataRows.forEach((row, index) => {
    const rowIndex = index + 3;
    const raw = toRawRow(rowIndex, row);
    const messages: string[] = [];
    let status: ProductImportValidatedRow["status"] = "valid";
    let input: ProductInput | undefined;

    if (Number.isNaN(raw.precio_ref)) {
      messages.push("precio_ref debe ser un numero valido.");
    }

    if (raw.costo_ref !== undefined && Number.isNaN(raw.costo_ref)) {
      messages.push("costo_ref debe ser un numero valido.");
    }

    if (raw.stock_inicial !== undefined && Number.isNaN(raw.stock_inicial)) {
      messages.push("stock_inicial debe ser un numero entero valido.");
    }

    if (raw.stock_minimo !== undefined && Number.isNaN(raw.stock_minimo)) {
      messages.push("stock_minimo debe ser un numero entero valido.");
    }

    const zodResult = productImportRowSchema.safeParse({
      sku: raw.sku,
      nombre: raw.nombre,
      categoria: raw.categoria,
      precio_ref: Number.isNaN(raw.precio_ref) ? -1 : raw.precio_ref,
      costo_ref: raw.costo_ref,
      stock_inicial: raw.stock_inicial,
      stock_minimo: raw.stock_minimo,
    });

    if (!zodResult.success) {
      zodResult.error.issues.forEach((issue) => {
        messages.push(issue.message);
      });
      status = "error";
    } else {
      const skuKey = zodResult.data.sku.toLowerCase();

      if (skuInFile.has(skuKey)) {
        messages.push(
          `SKU duplicado en el archivo (fila ${skuInFile.get(skuKey)}).`,
        );
        status = "error";
      } else {
        skuInFile.set(skuKey, rowIndex);
      }

      const categoryResult = resolveCategoryIdByName(zodResult.data.categoria, categories);

      if (categoryResult.error) {
        messages.push(categoryResult.error);
        status = "error";
      }

      if (status !== "error") {
        input = toProductInput(zodResult.data, categoryResult.categoryId);

        if (existingSkus.has(skuKey)) {
          messages.push("Este SKU ya existe en el catalogo.");
          status = "warning";
        }
      }
    }

    validated.push({
      rowIndex,
      sku: raw.sku || `(fila ${rowIndex})`,
      name: raw.nombre,
      status,
      messages,
      input,
    });
  });

  return validated;
}
