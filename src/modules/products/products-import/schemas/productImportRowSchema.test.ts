import {
  productImportRowSchema,
  PRODUCT_IMPORT_MAX_ROWS,
} from "./productImportRowSchema";

describe("productImportRowSchema", () => {
  it("accepts a valid row", () => {
    const result = productImportRowSchema.safeParse({
      sku: "BOD-001",
      codigo_barras: "7501234567890",
      nombre: "Chicle",
      categoria: "Chucherias",
      precio_ref: 1.5,
      costo_ref: 0.8,
      stock_inicial: 0,
      stock_minimo: 5,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sku).toBe("bod-001");
      expect(result.data.codigo_barras).toBe("7501234567890");
    }
  });

  it("normalizes optional barcode", () => {
    const result = productImportRowSchema.safeParse({
      sku: "bod-002",
      codigo_barras: " 750999 ",
      nombre: "Oreo",
      precio_ref: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.codigo_barras).toBe("750999");
    }
  });

  it("rejects empty sku and name", () => {
    const result = productImportRowSchema.safeParse({
      sku: "",
      nombre: "",
      precio_ref: 1,
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative price", () => {
    const result = productImportRowSchema.safeParse({
      sku: "BOD-002",
      nombre: "Oreo",
      precio_ref: -1,
    });

    expect(result.success).toBe(false);
  });

  it("documents max rows limit", () => {
    expect(PRODUCT_IMPORT_MAX_ROWS).toBe(500);
  });
});
