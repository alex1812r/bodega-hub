import * as XLSX from "xlsx";

import { resolveCategoryIdByName } from "./resolveCategoryIds";

describe("resolveCategoryIdByName", () => {
  const categories = [
    { id: "cat-1", name: "Chucherias" },
    { id: "cat-2", name: "Refrescos" },
  ] as const;

  it("matches category case-insensitively", () => {
    expect(resolveCategoryIdByName("chucherias", categories as never)).toEqual({
      categoryId: "cat-1",
    });
  });

  it("returns error when category is missing", () => {
    expect(resolveCategoryIdByName("Inexistente", categories as never).error).toContain(
      "no existe",
    );
  });

  it("allows empty category", () => {
    expect(resolveCategoryIdByName(undefined, categories as never)).toEqual({});
  });
});

function buildWorkbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Productos");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("parseProductImportWorkbook", () => {
  const categories = [{ id: "cat-1", name: "Chucherias", isActive: true }] as never[];

  it("parses valid rows", async () => {
    const { parseProductImportWorkbook } = await import("./parseProductImportWorkbook");
    const buffer = buildWorkbookBuffer([
      ["sku", "nombre", "categoria", "precio_ref", "costo_ref", "stock_inicial", "stock_minimo"],
      ["BOD-EJ-001", "Ejemplo", "Chucherias", 1.5, 0.8, 0, 5],
      ["BOD-001", "Chicle", "Chucherias", 2, 1, 10, 5],
    ]);

    const rows = parseProductImportWorkbook(buffer, categories);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("valid");
    expect(rows[0]?.input?.sku).toBe("BOD-001");
  });

  it("flags duplicate sku in file", async () => {
    const { parseProductImportWorkbook } = await import("./parseProductImportWorkbook");
    const buffer = buildWorkbookBuffer([
      ["sku", "nombre", "categoria", "precio_ref", "costo_ref", "stock_inicial", "stock_minimo"],
      ["BOD-EJ-001", "Ejemplo", "Chucherias", 1.5, 0.8, 0, 5],
      ["BOD-DUP", "A", "Chucherias", 1, 0.5, 0, 5],
      ["BOD-DUP", "B", "Chucherias", 2, 1, 0, 5],
    ]);

    const rows = parseProductImportWorkbook(buffer, categories);
    const duplicate = rows.find((row) => row.sku === "BOD-DUP" && row.name === "B");

    expect(duplicate?.status).toBe("error");
    expect(duplicate?.messages[0]).toContain("duplicado");
  });

  it("rejects invalid headers", async () => {
    const { parseProductImportWorkbook } = await import("./parseProductImportWorkbook");
    const buffer = buildWorkbookBuffer([["wrong", "headers"]]);

    expect(() => parseProductImportWorkbook(buffer, categories)).toThrow(
      "Encabezados invalidos",
    );
  });
});
