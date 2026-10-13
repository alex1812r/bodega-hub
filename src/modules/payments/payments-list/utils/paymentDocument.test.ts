import { getPaymentDocument } from "./paymentDocument";

describe("getPaymentDocument", () => {
  it("venta: numero de factura y enlace a su detalle", () => {
    expect(
      getPaymentDocument({
        relatedDocument: { href: "/sales/sale-001", label: "V-000001" },
        saleId: "sale-001",
      }),
    ).toEqual({ href: "/sales/sale-001", kind: "sale", label: "V-000001" });
  });

  it("compra: numero de compra y enlace a su detalle", () => {
    expect(
      getPaymentDocument({
        purchaseId: "purchase-001",
        relatedDocument: { href: "/purchases/purchase-001", label: "#C-001" },
      }),
    ).toEqual({ href: "/purchases/purchase-001", kind: "purchase", label: "#C-001" });
  });

  it("sin numero enlaza igual, con el tipo de documento y nunca con el id", () => {
    expect(getPaymentDocument({ saleId: "sale-001" })).toEqual({
      href: "/sales/sale-001",
      kind: "sale",
      label: "Venta",
    });
    expect(getPaymentDocument({ purchaseId: "purchase-001" })).toEqual({
      href: "/purchases/purchase-001",
      kind: "purchase",
      label: "Compra",
    });
  });

  it("un pago sin venta ni compra no tiene documento", () => {
    expect(getPaymentDocument({})).toBeNull();
  });
});
