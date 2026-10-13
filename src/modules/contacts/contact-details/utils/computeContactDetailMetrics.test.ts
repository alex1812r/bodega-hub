import { computeContactDetailMetrics, openBalanceRef } from "./computeContactDetailMetrics";

describe("computeContactDetailMetrics", () => {
  it("calcula ventas, pagos y saldo por cobrar para clientes", () => {
    const metrics = computeContactDetailMetrics([
        { status: "pagada", totalRef: 100 } as never,
        { status: "pendiente_pago", totalRef: 50 } as never,
      ],
      [],
      [{ amountRef: 80, direction: "entrada" } as never],
    );

    expect(metrics.salesTotalRef).toBe(150);
    expect(metrics.purchasesTotalRef).toBe(0);
    expect(metrics.paymentsTotalRef).toBe(80);
    expect(metrics.receivableRef).toBe(70);
    expect(metrics.payableRef).toBe(0);
  });

  it("calcula compras y saldo por pagar para proveedores", () => {
    const metrics = computeContactDetailMetrics([],
      [{ status: "recibido", totalRef: 40 } as never],
      [{ amountRef: 25, direction: "salida" } as never],
    );

    expect(metrics.purchasesTotalRef).toBe(40);
    expect(metrics.receivableRef).toBe(0);
    expect(metrics.payableRef).toBe(15);
  });

  it("separa por cobrar y por pagar para contactos mixtos", () => {
    const metrics = computeContactDetailMetrics([{ status: "pendiente_pago", totalRef: 20 } as never],
      [{ status: "pedido", totalRef: 30 } as never],
      [
        { amountRef: 10, direction: "entrada" } as never,
        { amountRef: 5, direction: "salida" } as never,
      ],
    );

    expect(metrics.receivableRef).toBe(10);
    expect(metrics.payableRef).toBe(25);
  });

  // PAG-F4 B: la tarjeta contradecía a la pestaña "Saldos" de la misma pantalla.
  describe("por cobrar / por pagar solo con documentos que admiten pago y pagos vigentes", () => {
    it("Constructora Horizonte: una venta en borrador y otra cancelada no dejan nada por cobrar", () => {
      const metrics = computeContactDetailMetrics([
          { id: "sale-003", status: "borrador", totalRef: 40 } as never,
          { id: "sale-004", status: "cancelada", totalRef: 38 } as never,
        ],
        [],
        [],
      );

      expect(metrics.receivableRef).toBe(0);
    });

    it("Ferreteria La Central: la venta devuelta y su pago no cuentan; queda la venta pendiente", () => {
      const metrics = computeContactDetailMetrics([
          { id: "sale-001", status: "pagada", totalRef: 15 } as never,
          { id: "sale-payroll-005", status: "pendiente_pago", totalRef: 60 } as never,
          { id: "sale-005", status: "devuelta", totalRef: 7 } as never,
        ],
        [],
        [
          { amountRef: 15, direction: "entrada", saleId: "sale-001", status: "activo" } as never,
          { amountRef: 7, direction: "entrada", saleId: "sale-005", status: "activo" } as never,
        ],
      );

      expect(metrics.receivableRef).toBe(60);
    });

    it("un pago anulado no baja lo por cobrar ni suma a los pagos realizados", () => {
      const sales = [{ id: "sale-payroll-005", status: "pendiente_pago", totalRef: 60 } as never];
      const active = {
        amountRef: 22,
        direction: "entrada",
        saleId: "sale-payroll-005",
        status: "activo",
      } as never;
      const voided = {
        amountRef: 100,
        direction: "entrada",
        saleId: "sale-payroll-005",
        status: "anulado",
      } as never;

      const metrics = computeContactDetailMetrics(sales, [], [active, voided]);

      expect(metrics.receivableRef).toBe(38);
      expect(metrics.paymentsTotalRef).toBe(22);
    });

    it("proveedor: las compras cancelada y devuelta y el pago anulado no cuentan en lo por pagar", () => {
      const metrics = computeContactDetailMetrics([],
        [
          { id: "purchase-001", status: "recibido", totalRef: 20 } as never,
          { id: "purchase-002", status: "pedido", totalRef: 52.4 } as never,
          { id: "purchase-003", status: "cancelado", totalRef: 33.5 } as never,
          { id: "purchase-004", status: "devuelto", totalRef: 18 } as never,
        ],
        [
          { amountRef: 20, direction: "salida", purchaseId: "purchase-001", status: "activo" } as never,
          { amountRef: 5.02, direction: "salida", purchaseId: "purchase-004", status: "activo" } as never,
          { amountRef: 30, direction: "salida", purchaseId: "purchase-002", status: "anulado" } as never,
        ],
      );

      expect(metrics.payableRef).toBeCloseTo(52.4, 2);
    });
  });
});

describe("PAG-F8 N2: por cobrar / por pagar con los totales de la pestaña Saldos", () => {
  // Primera página (10) de un contacto con más pagos: faltan los que saldaron la venta.
  const sales = [{ id: "s1", status: "pendiente_pago", totalRef: 628.75 } as never];
  const purchases = [{ id: "p1", status: "recibido", totalRef: 52.4 } as never];

  it("usa los saldos de los documentos abiertos en vez de la cuenta con la primera página", () => {
    const metrics = computeContactDetailMetrics(sales, purchases, [], {
      payableRef: 0,
      receivableRef: 0,
    });

    expect(metrics.receivableRef).toBe(0);
    expect(metrics.payableRef).toBe(0);
    // Las demás métricas no cambian.
    expect(metrics.salesTotalRef).toBe(628.75);
    expect(metrics.purchasesTotalRef).toBe(52.4);
    expect(metrics.paymentsTotalRef).toBe(0);
  });

  it("sin saldo conocido para una sección conserva el cálculo de siempre para esa métrica", () => {
    const metrics = computeContactDetailMetrics(sales, purchases, [], {
      receivableRef: 60,
    });

    expect(metrics.receivableRef).toBe(60);
    expect(metrics.payableRef).toBe(52.4);
    expect(computeContactDetailMetrics(sales, purchases, []).receivableRef).toBe(628.75);
  });

  it("openBalanceRef: el total en REF de la lista; 0 si no hay documentos; undefined si no se sabe", () => {
    expect(openBalanceRef(undefined)).toBeUndefined();
    expect(openBalanceRef({ count: 2, pendingRef: 26.62 })).toBe(26.62);
    expect(openBalanceRef({ count: 0 })).toBe(0);
    // Documentos sin equivalente en REF: no se inventa el saldo.
    expect(openBalanceRef({ count: 1 })).toBeUndefined();
  });
});
