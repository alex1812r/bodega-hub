import type { ProductImportRowResult, ProductImportValidatedRow } from "../types";
import { buildProductImportResults } from "./buildProductImportResults";

const rows: ProductImportValidatedRow[] = [
  {
    input: { name: "Pan", salePriceRef: 1, sku: "pan-1" },
    messages: [],
    name: "Pan",
    rowIndex: 3,
    sku: "pan-1",
    status: "valid",
  },
  {
    messages: ['La categoria "Panadería Lab" no existe. Seleccione un valor del listado de la plantilla.'],
    name: "Canilla",
    rowIndex: 4,
    sku: "pan-2",
    status: "error",
  },
  {
    input: { name: "Torta", salePriceRef: 3, sku: "pan-3" },
    messages: [],
    name: "Torta",
    rowIndex: 5,
    sku: "pan-3",
    status: "valid",
  },
];

describe("buildProductImportResults (PRO-F11)", () => {
  it("cuenta como error, con su motivo, la fila rechazada en la vista previa", () => {
    const jobResults: ProductImportRowResult[] = [
      { rowIndex: 3, sku: "pan-1", status: "success" },
      { rowIndex: 5, sku: "pan-3", status: "success" },
    ];

    const results = buildProductImportResults(rows, jobResults);

    expect(results.map((row) => [row.rowIndex, row.status])).toEqual([
      [3, "success"],
      [4, "failed"],
      [5, "success"],
    ]);
    expect(results[1]?.error).toContain('La categoria "Panadería Lab" no existe');
  });

  it("conserva el motivo del servidor de la fila que el BFF rechazó", () => {
    const results = buildProductImportResults(rows, [
      { rowIndex: 3, sku: "pan-1", status: "success" },
      { error: "Categoria no encontrada.", rowIndex: 5, sku: "pan-3", status: "failed" },
    ]);

    expect(results.filter((row) => row.status === "failed")).toHaveLength(2);
    expect(results[2]?.error).toBe("Categoria no encontrada.");
  });

  it("marca como omitida la fila válida que no llegó a enviarse", () => {
    const results = buildProductImportResults(rows, [
      { error: "SKU duplicado", rowIndex: 3, sku: "pan-1", status: "failed" },
    ]);

    expect(results[2]).toEqual({
      error: "No se procesó: la importación se detuvo antes de esta fila.",
      rowIndex: 5,
      sku: "pan-3",
      status: "skipped",
    });
  });
});
