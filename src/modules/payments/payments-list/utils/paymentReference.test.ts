import { getPaymentReference } from "./paymentReference";

describe("getPaymentReference", () => {
  it("muestra la factura enlazada aunque exista código de referencia bancario", () => {
    const reference = getPaymentReference({
      id: "pay-1",
      referenceCode: "778899",
      relatedDocument: { href: "/sales/sale-001", label: "V-000001" },
      saleId: "sale-001",
    } as never);

    expect(reference.fullValue).toBe("V-000001");
    expect(reference.displayValue).toBe("V-000001");
    expect(reference.href).toBe("/sales/sale-001");
    expect(reference.copyValue).toBe("778899");
  });

  it("trunca referencias largas y conserva el valor completo en title", () => {
    const reference = getPaymentReference({
      id: "pay-1",
      relatedDocument: {
        href: "/sales/sale-002",
        label: "V-20260521150631897",
      },
      saleId: "sale-002",
    } as never);

    expect(reference.displayValue).toBe("…1150631897");
    expect(reference.fullValue).toBe("V-20260521150631897");
    expect(reference.href).toBe("/sales/sale-002");
  });

  it("enlaza la venta cuando no hay documento relacionado enriquecido", () => {
    const reference = getPaymentReference({
      id: "pay-1",
      saleId: "sale-001",
    } as never);

    expect(reference.fullValue).toBe("sale-001");
    expect(reference.href).toBe("/sales/sale-001");
  });
});
