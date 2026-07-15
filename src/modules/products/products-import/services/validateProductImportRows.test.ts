import {
  draftToRawRow,
  revalidateProductImportRows,
  updateImportRowDraft,
  type ProductImportRowDraft,
} from "./validateProductImportRows";

const categories = [
  { id: "cat-1", name: "Chucherias" },
  { id: "cat-2", name: "Refrescos" },
] as const;

describe("validateProductImportRows", () => {
  it("revalidates duplicate sku after editing one row", () => {
    const rawRows = [
      {
        rowIndex: 3,
        sku: "A-1",
        nombre: "Uno",
        precio_ref: 1,
      },
      {
        rowIndex: 4,
        sku: "A-2",
        nombre: "Dos",
        precio_ref: 2,
      },
    ] as never[];

    const validated = revalidateProductImportRows(rawRows, {
      categories: categories as never,
      existingSkus: new Set(),
    });

    expect(validated.every((row) => row.status === "valid")).toBe(true);

    const draft: ProductImportRowDraft = {
      rowIndex: 4,
      sku: "A-1",
      codigo_barras: "",
      nombre: "Dos corregido",
      categoryId: "cat-1",
      precio_ref: "2",
      costo_ref: "",
      stock_inicial: "0",
      stock_minimo: "5",
    };

    const updated = updateImportRowDraft(validated, draft, {
      categories: categories as never,
      existingSkus: new Set(),
    });

    const row4 = updated.find((row) => row.rowIndex === 4);

    expect(row4?.status).toBe("error");
    expect(row4?.messages[0]).toContain("duplicado");
  });

  it("clears error when draft fixes invalid price", () => {
    const raw = draftToRawRow(
      {
        rowIndex: 5,
        sku: "FIX-1",
        codigo_barras: "",
        nombre: "Producto",
        categoryId: "cat-1",
        precio_ref: "no-numero",
        costo_ref: "",
        stock_inicial: "",
        stock_minimo: "",
      },
      categories as never,
    );

    const invalid = revalidateProductImportRows([raw], {
      categories: categories as never,
      existingSkus: new Set(),
    });

    expect(invalid[0]?.status).toBe("error");

    const fixed = updateImportRowDraft(invalid, {
      rowIndex: 5,
      sku: "FIX-1",
      codigo_barras: "",
      nombre: "Producto",
      categoryId: "cat-1",
      precio_ref: "3.5",
      costo_ref: "1",
      stock_inicial: "10",
      stock_minimo: "2",
    }, {
      categories: categories as never,
      existingSkus: new Set(),
    });

    expect(fixed[0]?.status).toBe("valid");
    expect(fixed[0]?.input?.salePriceRef).toBe(3.5);
  });

  it("revalidates duplicate barcode after editing one row", () => {
    const rawRows = [
      {
        rowIndex: 3,
        sku: "A-1",
        codigo_barras: "750111",
        nombre: "Uno",
        precio_ref: 1,
      },
      {
        rowIndex: 4,
        sku: "A-2",
        codigo_barras: "750222",
        nombre: "Dos",
        precio_ref: 2,
      },
    ] as never[];

    const validated = revalidateProductImportRows(rawRows, {
      categories: categories as never,
      existingSkus: new Set(),
    });

    expect(validated.every((row) => row.status === "valid")).toBe(true);

    const draft: ProductImportRowDraft = {
      rowIndex: 4,
      sku: "A-2",
      codigo_barras: "750111",
      nombre: "Dos corregido",
      categoryId: "cat-1",
      precio_ref: "2",
      costo_ref: "",
      stock_inicial: "0",
      stock_minimo: "5",
    };

    const updated = updateImportRowDraft(validated, draft, {
      categories: categories as never,
      existingSkus: new Set(),
    });

    const row4 = updated.find((row) => row.rowIndex === 4);

    expect(row4?.status).toBe("error");
    expect(row4?.messages[0]).toContain("Codigo de barras");
  });
});
