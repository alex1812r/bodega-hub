import ExcelJS from "exceljs";

import type { CategoryMock } from "@/shared/mocks/erp-data";

import {
  PRODUCT_IMPORT_CATEGORIES_SHEET,
  PRODUCT_IMPORT_EXAMPLE_ROW,
  PRODUCT_IMPORT_HEADERS,
  PRODUCT_IMPORT_INSTRUCTIONS_SHEET,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_SHEET,
} from "../schemas/productImportRowSchema";

const INSTRUCTIONS = [
  "Importacion masiva de productos",
  "",
  "1. Complete la hoja Productos desde la fila 3.",
  "2. No modifique los encabezados de la fila 1.",
  "3. En columna categoria use SOLO el desplegable (lista validada).",
  "4. No escriba categorias manualmente ni valores fuera de la lista.",
  "5. No repita SKU dentro del archivo.",
  "6. Maximo 500 filas de datos.",
  "7. Requiere permiso products.manage para importar.",
];

const CATEGORY_COLUMN = "C";
const FIRST_DATA_ROW = 3;
const LAST_DATA_ROW = PRODUCT_IMPORT_MAX_ROWS + FIRST_DATA_ROW - 1;

function applyCategoryDropdown(
  productsSheet: ExcelJS.Worksheet,
  categoryCount: number,
) {
  if (categoryCount === 0) {
    return;
  }

  const lastCategoryRow = categoryCount + 1;
  const listRange = `${PRODUCT_IMPORT_CATEGORIES_SHEET}!$A$2:$A$${lastCategoryRow}`;

  productsSheet.dataValidations.add(
    `${CATEGORY_COLUMN}${FIRST_DATA_ROW}:${CATEGORY_COLUMN}${LAST_DATA_ROW}`,
    {
      type: "list",
      allowBlank: true,
      formulae: [listRange],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Categoria invalida",
      error: "Seleccione una categoria del listado desplegable.",
      showInputMessage: true,
      promptTitle: "Categoria",
      prompt: "Elija una categoria de la lista (hoja Categorias).",
    },
  );
}

export async function buildProductImportWorkbook(categories: CategoryMock[] = []) {
  const workbook = new ExcelJS.Workbook();
  const exampleCategory =
    categories.find(
      (category) =>
        category.name.localeCompare(PRODUCT_IMPORT_EXAMPLE_ROW.categoria ?? "", undefined, {
          sensitivity: "accent",
        }) === 0,
    )?.name ??
    categories[0]?.name ??
    PRODUCT_IMPORT_EXAMPLE_ROW.categoria ??
    "";

  const categoriesSheet = workbook.addWorksheet(PRODUCT_IMPORT_CATEGORIES_SHEET);
  categoriesSheet.addRow(["nombre"]);
  categories.forEach((category) => categoriesSheet.addRow([category.name]));

  const productsSheet = workbook.addWorksheet(PRODUCT_IMPORT_SHEET);
  productsSheet.addRow([...PRODUCT_IMPORT_HEADERS]);
  productsSheet.addRow([
    PRODUCT_IMPORT_EXAMPLE_ROW.sku,
    PRODUCT_IMPORT_EXAMPLE_ROW.nombre,
    exampleCategory,
    PRODUCT_IMPORT_EXAMPLE_ROW.precio_ref,
    PRODUCT_IMPORT_EXAMPLE_ROW.costo_ref ?? "",
    PRODUCT_IMPORT_EXAMPLE_ROW.stock_inicial ?? "",
    PRODUCT_IMPORT_EXAMPLE_ROW.stock_minimo ?? "",
  ]);

  applyCategoryDropdown(productsSheet, categories.length);

  const instructionsSheet = workbook.addWorksheet(PRODUCT_IMPORT_INSTRUCTIONS_SHEET);
  INSTRUCTIONS.forEach((line) => instructionsSheet.addRow([line]));

  return workbook;
}

export async function productImportTemplateToBuffer(categories: CategoryMock[] = []) {
  const workbook = await buildProductImportWorkbook(categories);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export type ProductImportTemplateDownloadResult = {
  error?: string;
  source: "api" | "client";
  usedFallback: boolean;
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadProductImportTemplate(categories: CategoryMock[] = []) {
  const buffer = await productImportTemplateToBuffer(categories);
  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "plantilla-productos.xlsx",
  );
}

export async function downloadProductImportTemplateFromApi(
  categories: CategoryMock[] = [],
): Promise<ProductImportTemplateDownloadResult> {
  try {
    const response = await fetch("/api/products/import/template", {
      credentials: "include",
    });

    if (!response.ok) {
      let message = `No se pudo descargar la plantilla (${response.status}).`;

      try {
        const payload = (await response.json()) as { error?: { message?: string } };
        if (payload.error?.message) {
          message = payload.error.message;
        }
      } catch {
        // binary or empty body
      }

      await downloadProductImportTemplate(categories);
      return {
        source: "client",
        usedFallback: true,
        error: `${message} Se uso la plantilla generada en el navegador.`,
      };
    }

    const blob = await response.blob();
    triggerBlobDownload(blob, "plantilla-productos.xlsx");
    return { source: "api", usedFallback: false };
  } catch (error) {
    await downloadProductImportTemplate(categories);
    return {
      source: "client",
      usedFallback: true,
      error:
        error instanceof Error
          ? `${error.message}. Se uso la plantilla generada en el navegador.`
          : "Se uso la plantilla generada en el navegador.",
    };
  }
}
