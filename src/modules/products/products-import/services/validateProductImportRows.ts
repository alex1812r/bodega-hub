import type { CategoryMock } from "@/shared/mocks/erp-data";

import type { ProductInput } from "../../hooks/useProducts";
import { productImportRowSchema } from "../schemas/productImportRowSchema";
import type { ProductImportRawRow, ProductImportValidatedRow } from "../types";
import { resolveCategoryIdByName } from "./resolveCategoryIds";

export type ProductImportRowDraft = {
  categoryId: string;
  codigo_barras: string;
  costo_ref: string;
  nombre: string;
  precio_ref: string;
  rowIndex: number;
  sku: string;
  stock_inicial: string;
  stock_minimo: string;
};

export type ValidateProductImportRowsOptions = {
  categories: CategoryMock[];
  existingSkus: Set<string>;
};

function toProductInput(
  parsed: ReturnType<typeof productImportRowSchema.parse>,
  categoryId?: string,
): ProductInput {
  return {
    barcode: parsed.codigo_barras,
    sku: parsed.sku,
    name: parsed.nombre,
    categoryId,
    salePriceRef: parsed.precio_ref,
    currentCostRef: parsed.costo_ref ?? 0,
    currentStock: parsed.stock_inicial ?? 0,
    minStock: parsed.stock_minimo ?? 5,
  };
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();

  if (trimmed === "") {
    return undefined;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function draftToRawRow(draft: ProductImportRowDraft, categories: CategoryMock[]): ProductImportRawRow {
  const categoryName = draft.categoryId
    ? categories.find((category) => category.id === draft.categoryId)?.name
    : undefined;

  return {
    rowIndex: draft.rowIndex,
    sku: draft.sku.trim().toLowerCase(),
    codigo_barras: draft.codigo_barras.trim() || undefined,
    nombre: draft.nombre.trim(),
    categoria: categoryName,
    precio_ref: parseOptionalNumber(draft.precio_ref) ?? Number.NaN,
    costo_ref: parseOptionalNumber(draft.costo_ref),
    stock_inicial: parseOptionalNumber(draft.stock_inicial),
    stock_minimo: parseOptionalNumber(draft.stock_minimo),
  };
}

export function validatedRowToDraft(
  row: ProductImportValidatedRow,
): ProductImportRowDraft {
  const input = row.input;

  return {
    rowIndex: row.rowIndex,
    sku: row.sku.startsWith("(fila") ? "" : row.sku,
    codigo_barras: input?.barcode ?? "",
    nombre: row.name,
    categoryId: input?.categoryId ?? "",
    precio_ref:
      input?.salePriceRef !== undefined ? String(input.salePriceRef) : "",
    costo_ref:
      input?.currentCostRef !== undefined ? String(input.currentCostRef) : "",
    stock_inicial:
      input?.currentStock !== undefined ? String(input.currentStock) : "",
    stock_minimo: input?.minStock !== undefined ? String(input.minStock) : "",
  };
}

export function validateProductImportRawRow(
  raw: ProductImportRawRow,
  skuInFile: Map<string, number>,
  barcodeInFile: Map<string, number>,
  options: ValidateProductImportRowsOptions,
): ProductImportValidatedRow {
  const { categories, existingSkus } = options;
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
    codigo_barras: raw.codigo_barras,
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
    const duplicateRow = skuInFile.get(skuKey);

    if (duplicateRow !== undefined) {
      messages.push(`SKU duplicado en el archivo (fila ${duplicateRow}).`);
      status = "error";
    }

    const barcodeKey = zodResult.data.codigo_barras ?? "";
    if (barcodeKey) {
      const duplicateBarcodeRow = barcodeInFile.get(barcodeKey);
      if (duplicateBarcodeRow !== undefined) {
        messages.push(`Codigo de barras duplicado en el archivo (fila ${duplicateBarcodeRow}).`);
        status = "error";
      }
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

  return {
    rowIndex: raw.rowIndex,
    sku: raw.sku || `(fila ${raw.rowIndex})`,
    name: raw.nombre,
    status,
    messages,
    input,
  };
}

export function revalidateProductImportRows(
  rawRows: ProductImportRawRow[],
  options: ValidateProductImportRowsOptions,
): ProductImportValidatedRow[] {
  const skuInFile = new Map<string, number>();
  const barcodeInFile = new Map<string, number>();
  const validated: ProductImportValidatedRow[] = [];

  for (const raw of rawRows) {
    const row = validateProductImportRawRow(raw, skuInFile, barcodeInFile, options);
    validated.push(row);

    if (row.status !== "error" && raw.sku.trim()) {
      skuInFile.set(raw.sku.trim().toLowerCase(), raw.rowIndex);
    }

    const barcode = raw.codigo_barras?.trim();
    if (row.status !== "error" && barcode) {
      barcodeInFile.set(barcode, raw.rowIndex);
    }
  }

  return validated;
}

export function updateImportRowDraft(
  rows: ProductImportValidatedRow[],
  draft: ProductImportRowDraft,
  options: ValidateProductImportRowsOptions,
): ProductImportValidatedRow[] {
  const rawRows = rows.map((row) => {
    if (row.rowIndex === draft.rowIndex) {
      return draftToRawRow(draft, options.categories);
    }

    return draftToRawRow(validatedRowToDraft(row), options.categories);
  });

  return revalidateProductImportRows(rawRows, options);
}
