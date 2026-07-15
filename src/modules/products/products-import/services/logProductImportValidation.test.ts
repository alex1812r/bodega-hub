import {
  formatZodIssuesForLog,
  isProductImportValidationLoggingEnabled,
  rawCellsFromExcelRow,
} from "./logProductImportValidation";
import { productImportRowSchema } from "../schemas/productImportRowSchema";

describe("logProductImportValidation", () => {
  it("rawCellsFromExcelRow describes empty and typed cells", () => {
    const cells = rawCellsFromExcelRow([
      "SKU-1",
      "",
      "Nombre",
      "",
      "no-es-numero",
      1.5,
      0,
      5,
    ]);

    expect(cells.sku).toContain("SKU-1");
    expect(cells.categoria).toContain("vacío");
    expect(cells.precio_ref).toContain("no-es-numero");
    expect(cells.costo_ref).toContain("1.5");
  });

  it("formatZodIssuesForLog maps schema paths", () => {
    const result = productImportRowSchema.safeParse({
      sku: "",
      nombre: "",
      precio_ref: -1,
    });

    if (result.success) {
      throw new Error("expected validation failure");
    }

    const issues = formatZodIssuesForLog(result.error.issues);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.path.includes("sku") || issue.path.includes("nombre"))).toBe(
      true,
    );
  });

  it("is disabled outside development unless debug flag is set", () => {
    const original = process.env.NEXT_PUBLIC_PRODUCT_IMPORT_DEBUG;
    process.env.NEXT_PUBLIC_PRODUCT_IMPORT_DEBUG = undefined;

    expect(isProductImportValidationLoggingEnabled()).toBe(
      process.env.NODE_ENV === "development",
    );

    process.env.NEXT_PUBLIC_PRODUCT_IMPORT_DEBUG = original;
  });
});
