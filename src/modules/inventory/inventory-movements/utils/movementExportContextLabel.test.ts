import { buildMovementsExportContextLabel } from "./movementExportContextLabel";

describe("buildMovementsExportContextLabel", () => {
  it("says there is no period filter when nothing is filtered", () => {
    expect(buildMovementsExportContextLabel({})).toBe("Sin filtro de periodo");
  });

  it("lists every filter of the list, including document and document kind", () => {
    expect(
      buildMovementsExportContextLabel({
        document: "V-00",
        documentKind: "venta",
        from: "2026-10-01",
        productId: "p-harina",
        to: "2026-10-05",
        type: "venta",
      }),
    ).toBe(
      "Periodo: 2026-10-01 a 2026-10-05 | Producto: p-harina | Tipo: Venta | Tipo de documento: Venta | Documento: V-00",
    );
  });

  it("names the movements without a document 'Ajuste manual'", () => {
    expect(buildMovementsExportContextLabel({ documentKind: "sin_documento" })).toBe(
      "Sin filtro de periodo | Tipo de documento: Ajuste manual",
    );
  });
});
