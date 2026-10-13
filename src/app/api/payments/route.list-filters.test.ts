/**
 * @jest-environment node
 */
/**
 * PAG-05 · `GET /api/payments` filtra por `method` y por rango de dias operativos
 * Caracas (`from`/`to`, inclusive), valida los tres y no cambia las reglas de rol.
 */

import { GET } from "./route";

type ListedPayment = { createdAt: string; direction: string; id: string; method: string };

async function list(query: string, role?: string) {
  const response = await GET(
    new Request(`http://localhost/api/payments?${query}`, {
      headers: role ? { "x-demo-role": role } : undefined,
    }),
  );
  const body = await response.json();

  return {
    body,
    ids: ((body.data?.items ?? []) as ListedPayment[]).map((payment) => payment.id).sort(),
    status: response.status,
  };
}

describe("GET /api/payments · method, from y to (PAG-05)", () => {
  it("filtra por metodo dentro de un rango de fechas", async () => {
    const result = await list("method=transferencia&from=2026-05-14&to=2026-05-18&limit=100");

    expect(result.status).toBe(200);
    expect(result.ids).toEqual(["pay-003", "pay-007"]);
  });

  it("el rango incluye los dos dias extremos", async () => {
    const result = await list("from=2026-05-15&to=2026-05-17&limit=100");

    expect(result.status).toBe(200);
    expect(result.ids).toEqual(["pay-003", "pay-005", "pay-006"]);
  });

  it("acepta solo `from` o solo `to`", async () => {
    const until = await list("to=2026-05-14&limit=100");
    const since = await list("from=2026-05-18&to=2026-05-18&limit=100");

    expect(until.ids).toEqual(["pay-007"]);
    expect(since.ids).toEqual(["pay-001", "pay-002", "pay-004"]);
  });

  it("se combina con direction y pagina sobre el resultado filtrado", async () => {
    const result = await list(
      "direction=salida&method=efectivo_ves&from=2026-05-01&to=2026-05-31&limit=1&skip=0",
    );

    expect(result.status).toBe(200);
    expect(result.ids).toEqual(["pay-006"]);
    expect(result.body.data.total).toBe(1);
  });

  it("un parametro vacio equivale a no enviarlo", async () => {
    const result = await list("method=&from=&to=2026-05-14&limit=100");

    expect(result.status).toBe(200);
    expect(result.ids).toEqual(["pay-007"]);
  });

  it.each([
    ["metodo desconocido", "method=bitcoin"],
    ["fecha con otro formato", "from=18/05/2026"],
    ["fecha que no existe", "to=2026-02-31"],
    ["fecha con hora", "from=2026-05-18T00:00:00Z"],
    ["rango invertido", "from=2026-05-18&to=2026-05-17"],
  ])("rechaza con 400: %s", async (_case, query) => {
    const result = await list(query);

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("BAD_REQUEST");
  });

  it("el vendedor filtra por metodo y fecha pero sigue sin ver pagos de compra", async () => {
    const result = await list("method=efectivo_ves&from=2026-05-01&to=2026-05-31&limit=100", "vendedor");

    expect(result.status).toBe(200);
    // pay-006 es efectivo_ves pero es la salida de una compra.
    expect(result.ids).toEqual(["pay-004"]);
  });

  it("el vendedor sigue recibiendo 403 al pedir compras o salidas, con filtros nuevos o sin ellos", async () => {
    expect((await list("purchaseId=purchase-001&method=transferencia", "vendedor")).status).toBe(403);
    expect((await list("direction=salida&from=2026-05-01", "vendedor")).status).toBe(403);
  });
});
