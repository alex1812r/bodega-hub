/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/purchases", () => {
  it("returns purchases for warehouse role", async () => {
    const response = await GET(
      new Request("http://localhost/api/purchases", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("creates a simulated purchase", async () => {
    const response = await POST(
      new Request("http://localhost/api/purchases", {
        body: JSON.stringify({
          discountRef: 0,
          discountVes: 0,
          items: [
            {
              costCurrency: "ref",
              entryMode: "unit",
              productId: "prod-cable",
              quantity: 2,
              subtotalRef: 4,
              subtotalVes: 2040,
              taxRate: 0,
              taxRef: 0,
              taxVes: 0,
              unitCostRef: 2,
              unitCostVes: 1020,
            },
          ],
          refRateVes: 510,
          subtotalRef: 4,
          subtotalVes: 2040,
          supplierId: "cont-supplier",
          taxRef: 0,
          taxVes: 0,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("recibido");
  });

  it("creates a purchase in pedido status", async () => {
    const response = await POST(
      new Request("http://localhost/api/purchases", {
        body: JSON.stringify({
          discountRef: 0,
          discountVes: 0,
          items: [
            {
              costCurrency: "ref",
              entryMode: "unit",
              productId: "prod-cable",
              quantity: 2,
              subtotalRef: 4,
              subtotalVes: 2040,
              taxRate: 0,
              taxRef: 0,
              taxVes: 0,
              unitCostRef: 2,
              unitCostVes: 1020,
            },
          ],
          refRateVes: 510,
          status: "pedido",
          subtotalRef: 4,
          subtotalVes: 2040,
          supplierId: "cont-supplier",
          taxRef: 0,
          taxVes: 0,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("pedido");
  });

  it("filters purchases by supplier and date range", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/purchases?supplierId=cont-supplier&from=2026-05-17&to=2026-05-17",
        {
          headers: { "x-demo-role": "almacen" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].supplierId).toBe("cont-supplier");
  });

  describe("GET · filtros del listado (COM-08)", () => {
    function list(query: string, role = "almacen") {
      return GET(
        new Request(`http://localhost/api/purchases?${query}`, {
          headers: { "x-demo-role": role },
        }),
      );
    }

    it.each([
      ["from con otro formato", "from=17-05-2026"],
      ["from que no existe", "from=2026-02-31"],
      ["to que no es una fecha", "to=ayer"],
      ["rango invertido", "from=2026-05-18&to=2026-05-17"],
      ["pendingBalance distinto de 1", "pendingBalance=true"],
    ])("%s → 400", async (_label, query) => {
      const response = await list(query);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.message).toEqual(expect.any(String));
    });

    it("pasa el rango al servicio: solo las compras de esos días", async () => {
      const response = await list("from=2026-05-16&to=2026-05-17&limit=100");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items.map((purchase: { id: string }) => purchase.id).sort()).toEqual([
        "purchase-001",
        "purchase-003",
      ]);
      expect(body.data).not.toHaveProperty("pendingBalanceRef");
    });

    it.each(["almacen", "admin"])(
      "pendingBalance=1 (%s): solo compras con saldo, con Pagado/total y la suma del filtro",
      async (role) => {
        const response = await list("pendingBalance=1&limit=100", role);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.total).toBe(1);
        expect(body.data.pendingBalanceRef).toBe(52.4);
        expect(body.data.items).toEqual([
          expect.objectContaining({ id: "purchase-002", paidRef: 0, totalRef: 52.4 }),
        ]);
      },
    );

    it("un parámetro vacío equivale a no enviarlo", async () => {
      const response = await list("from=&to=%20&pendingBalance=&limit=100");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.total).toBeGreaterThanOrEqual(4);
      expect(body.data).not.toHaveProperty("pendingBalanceRef");
    });

    it("sin permiso para ver compras → 403", async () => {
      const response = await list("pendingBalance=1", "vendedor");

      expect(response.status).toBe(403);
    });
  });
});
