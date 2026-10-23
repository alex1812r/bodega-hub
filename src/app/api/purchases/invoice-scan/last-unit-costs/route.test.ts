/**
 * @jest-environment node
 */
/**
 * REP9-01 (D41-a/D42) · `GET /api/purchases/invoice-scan/last-unit-costs`: último costo por
 * unidad de stock (REF) de productos elegidos en la revisión fuera de los candidatos (buscador
 * o alta), con la misma semántica que `InvoiceLineMatch.lastUnitCostRef` (D38). Solo ids en la
 * URL. Permiso `purchases.create`.
 */
import { GET } from "./route";

const BASE_URL = "http://localhost/api/purchases/invoice-scan/last-unit-costs";

function get(query = "", role = "almacen") {
  return GET(new Request(`${BASE_URL}${query}`, { headers: { "x-demo-role": role } }));
}

describe("GET /api/purchases/invoice-scan/last-unit-costs", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each([
    ["admin", 200],
    ["almacen", 200],
    ["contador", 403],
    ["vendedor", 403],
  ])("responde a %s con %i (permiso purchases.create)", async (role, status) => {
    expect((await get("?productIds=prod-drill", role)).status).toBe(status);
  });

  it("un elemento por producto pedido (sin repetidos), con su último costo por unidad o null", async () => {
    const response = await get("?productIds=prod-drill,prod-cigar-pack,no-existe,prod-drill&supplierId=cont-supplier");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: [
        { productId: "prod-drill", lastUnitCostRef: 8.5 },
        // Producto con receta: su costo es por empaque (12,5) y se reparte entre sus 10 unidades.
        { productId: "prod-cigar-pack", lastUnitCostRef: 1.25 },
        { productId: "no-existe", lastUnitCostRef: null },
      ],
    });
  });

  it("admite 50 productos y rechaza 51", async () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `prod-lote-${index}`).join(",");

    expect((await get(`?productIds=${ids(50)}`)).status).toBe(200);
    expect((await get(`?productIds=${ids(51)}`)).status).toBe(400);
  });

  it.each([
    [""],
    ["?productIds="],
    ["?productIds=prod-drill,"],
    ["?productIds=prod%20drill"],
    ["?productIds=prod-drill%00"],
    [`?productIds=${"a".repeat(65)}`],
    ["?productIds=prod-drill&supplierId="],
    ["?productIds=prod-drill&supplierId=..%2Fproducts"],
    ["?productIds=MALTA%201.5L"],
  ])("responde 400 con parámetros inválidos (%s)", async (query) => {
    const response = await get(query);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
  });
});
