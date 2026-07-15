import { computeContactDetailMetrics } from "./computeContactDetailMetrics";

describe("computeContactDetailMetrics", () => {
  it("calcula ventas, pagos y saldo por cobrar para clientes", () => {
    const metrics = computeContactDetailMetrics(
      "cliente",
      [{ totalRef: 100 } as never, { totalRef: 50 } as never],
      [],
      [{ amountRef: 80, direction: "entrada" } as never],
    );

    expect(metrics.operationsLabel).toBe("Total Ventas (REF)");
    expect(metrics.operationsTotalRef).toBe(150);
    expect(metrics.paymentsTotalRef).toBe(80);
    expect(metrics.receivableRef).toBe(70);
    expect(metrics.payableRef).toBe(0);
  });

  it("calcula compras y saldo por pagar para proveedores", () => {
    const metrics = computeContactDetailMetrics(
      "proveedor",
      [],
      [{ totalRef: 40 } as never],
      [{ amountRef: 25, direction: "salida" } as never],
    );

    expect(metrics.operationsLabel).toBe("Total Compras (REF)");
    expect(metrics.receivableRef).toBe(0);
    expect(metrics.payableRef).toBe(15);
  });

  it("separa por cobrar y por pagar para contactos mixtos", () => {
    const metrics = computeContactDetailMetrics(
      "ambos",
      [{ totalRef: 20 } as never],
      [{ totalRef: 30 } as never],
      [
        { amountRef: 10, direction: "entrada" } as never,
        { amountRef: 5, direction: "salida" } as never,
      ],
    );

    expect(metrics.receivableRef).toBe(10);
    expect(metrics.payableRef).toBe(25);
  });
});
