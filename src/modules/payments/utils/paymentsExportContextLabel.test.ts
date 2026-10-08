/**
 * @jest-environment node
 */

import { buildPaymentsExportContextLabel } from "./paymentsExportContextLabel";

describe("buildPaymentsExportContextLabel", () => {
  it("sin filtros solo lleva el titulo", () => {
    expect(buildPaymentsExportContextLabel({})).toBe("Listado de pagos");
  });

  it("describe el metodo y el rango de fechas en español (PAG-05)", () => {
    expect(
      buildPaymentsExportContextLabel({
        direction: "entrada",
        from: "2026-10-01",
        method: "pago_movil",
        to: "2026-10-06",
      }),
    ).toBe("Listado de pagos | Tipo: Entrada | Método: Pago móvil | Desde: 01/10/2026 | Hasta: 06/10/2026");
  });

  it("admite un rango abierto por un lado", () => {
    expect(buildPaymentsExportContextLabel({ from: "2026-10-01" })).toBe(
      "Listado de pagos | Desde: 01/10/2026",
    );
    expect(buildPaymentsExportContextLabel({ method: "efectivo_usd", to: "2026-10-06" })).toBe(
      "Listado de pagos | Método: Efectivo USD | Hasta: 06/10/2026",
    );
  });
});
