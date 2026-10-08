/**
 * @jest-environment node
 */

import { buildPaymentsExportContextLabel } from "./paymentsExportContextLabel";

describe("buildPaymentsExportContextLabel", () => {
  it("sin filtros solo lleva el titulo", () => {
    expect(buildPaymentsExportContextLabel({})).toBe("Listado de pagos");
  });

  it("los filtros de enlace profundo salen con el texto humano de sus chips (PAG-F2)", () => {
    expect(
      buildPaymentsExportContextLabel(
        { contactId: "cont-both", direction: "entrada", saleId: "sale-002" },
        ["Venta V-000002", "Contacto: Comercial Doble Via"],
      ),
    ).toBe("Listado de pagos | Venta V-000002 | Contacto: Comercial Doble Via | Tipo: Entrada");
  });

  it("sin texto humano conocido omite el filtro: nunca escribe un id (PAG-F2)", () => {
    const label = buildPaymentsExportContextLabel({
      contactId: "cont-both",
      method: "pago_movil",
      purchaseId: "purchase-002",
      saleId: "sale-002",
    });

    expect(label).toBe("Listado de pagos | Método: Pago móvil");
    expect(label).not.toMatch(/cont-both|purchase-002|sale-002/);
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
