import ExcelJS from "exceljs";

import {
  PRODUCT_IMPORT_CATEGORIES_SHEET,
  PRODUCT_IMPORT_SHEET,
} from "../schemas/productImportRowSchema";
import { buildProductImportWorkbook, productImportTemplateToBuffer } from "./buildProductImportTemplate";

describe("buildProductImportTemplate", () => {
  const categories = [
    { id: "cat-1", name: "Chucherias", isActive: true },
    { id: "cat-2", name: "Refrescos", isActive: true },
  ] as never[];

  it("adds list validation on categoria column referencing Categorias sheet", async () => {
    const workbook = await buildProductImportWorkbook(categories);
    const productsSheetBeforeWrite = workbook.getWorksheet(PRODUCT_IMPORT_SHEET);
    const rangeValidation =
      productsSheetBeforeWrite?.dataValidations?.model?.["C3:C502"];

    expect(rangeValidation?.type).toBe("list");
    expect(rangeValidation?.formulae?.[0]).toContain(PRODUCT_IMPORT_CATEGORIES_SHEET);
    expect(rangeValidation?.formulae?.[0]).toContain("$A$2:$A$3");

    const buffer = await productImportTemplateToBuffer(categories);
    const loadedWorkbook = new ExcelJS.Workbook();
    await loadedWorkbook.xlsx.load(buffer);

    const productsSheet = loadedWorkbook.getWorksheet(PRODUCT_IMPORT_SHEET);
    const cellValidation = productsSheet?.dataValidations?.model?.["C3"];

    expect(cellValidation?.type).toBe("list");
    expect(cellValidation?.formulae?.[0]).toContain(PRODUCT_IMPORT_CATEGORIES_SHEET);
    expect(cellValidation?.formulae?.[0]).toContain("$A$2:$A$3");
  });

  it("includes category names on Categorias sheet", async () => {
    const workbook = await buildProductImportWorkbook(categories);
    const categoriesSheet = workbook.getWorksheet(PRODUCT_IMPORT_CATEGORIES_SHEET);

    expect(categoriesSheet?.getCell("A2").value).toBe("Chucherias");
    expect(categoriesSheet?.getCell("A3").value).toBe("Refrescos");
  });
});
