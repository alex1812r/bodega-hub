/**
 * @jest-environment node
 */
/**
 * COM-F11 · `GET /api/purchases/last-costs`: último costo de compra (unitario sin IVA)
 * de unos productos, para sugerir el costo de una línea. Permiso `purchases.create`.
 */

import { createdMockPurchases } from "@/modules/purchases/services/purchaseMockStore";
import {
  mockPurchaseItems,
  mockPurchases,
  type PurchaseStatus,
} from "@/shared/mocks/erp-data";

import { GET } from "./route";

const BASE_URL = "http://localhost/api/purchases/last-costs";

type LastCostBody = { productId: string; source: string; taxRate: number; unitCostRef: number };

function get(query = "", role?: string) {
  return GET(
    new Request(`${BASE_URL}${query}`, {
      headers: role ? { "x-demo-role": role } : undefined,
    }),
  );
}

async function lastCosts(query: string, role?: string) {
  const response = await get(query, role);
  const body = await response.json();

  expect(response.status).toBe(200);

  return body.data as LastCostBody[];
}

describe("GET /api/purchases/last-costs", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const seededPurchases = mockPurchases.length;
  const seededItems = mockPurchaseItems.length;

  function addPurchase(input: {
    createdAt: string;
    id: string;
    productId: string;
    status: PurchaseStatus;
    supplierId: string;
    taxRate: number;
    unitCostRef: number;
  }) {
    mockPurchases.push({
      createdAt: input.createdAt,
      discountRef: 0,
      id: input.id,
      paidVes: 0,
      purchaseNumber: input.id,
      refRateVes: 510,
      status: input.status,
      subtotalRef: input.unitCostRef,
      supplierId: input.supplierId,
      taxRef: 0,
      totalRef: input.unitCostRef,
      totalVes: 0,
      userId: "user-warehouse",
    });
    mockPurchaseItems.push({
      productId: input.productId,
      purchaseId: input.id,
      quantity: 1,
      subtotalRef: input.unitCostRef,
      subtotalVes: 0,
      taxRate: input.taxRate,
      unitCostRef: input.unitCostRef,
      unitCostVes: 0,
    });
  }

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    mockPurchases.splice(seededPurchases);
    mockPurchaseItems.splice(seededItems);
    createdMockPurchases().clear();
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
    const response = await get("?supplierId=cont-supplier&productIds=prod-cable", role);

    expect(response.status).toBe(status);
  });

  it("devuelve por producto solo productId, unitCostRef, taxRate y source", async () => {
    expect(await lastCosts("?supplierId=cont-supplier&productIds=prod-cable", "almacen")).toEqual([
      { productId: "prod-cable", source: "supplier", taxRate: 0, unitCostRef: 2 },
    ]);
  });

  it("primero la última compra recibida de ese proveedor; si no hay, la de cualquiera", async () => {
    addPurchase({
      createdAt: "2026-06-03T10:00:00.000Z",
      id: "f11-exenta",
      productId: "prod-drill",
      status: "recibido",
      supplierId: "cont-supplier",
      taxRate: 0,
      unitCostRef: 2494.41,
    });
    addPurchase({
      createdAt: "2026-06-09T10:00:00.000Z",
      id: "f11-otro-proveedor",
      productId: "prod-drill",
      status: "recibido",
      supplierId: "cont-both",
      taxRate: 16,
      unitCostRef: 3000,
    });

    expect(await lastCosts("?supplierId=cont-supplier&productIds=prod-drill,prod-cable")).toEqual([
      { productId: "prod-drill", source: "supplier", taxRate: 0, unitCostRef: 2494.41 },
      { productId: "prod-cable", source: "supplier", taxRate: 0, unitCostRef: 2 },
    ]);
    expect(await lastCosts("?supplierId=cont-supplier-tools&productIds=prod-drill")).toEqual([
      { productId: "prod-drill", source: "any", taxRate: 16, unitCostRef: 3000 },
    ]);
  });

  it.each<[PurchaseStatus]>([["pedido"], ["cancelado"], ["devuelto"]])(
    "una compra en estado %s no cuenta: el producto no aparece en la respuesta",
    async (status) => {
      addPurchase({
        createdAt: "2026-06-03T10:00:00.000Z",
        id: `f11-${status}`,
        productId: "prod-latex",
        status,
        supplierId: "cont-supplier",
        taxRate: 16,
        unitCostRef: 9,
      });

      expect(await lastCosts("?supplierId=cont-supplier&productIds=prod-latex,prod-cable")).toEqual([
        { productId: "prod-cable", source: "supplier", taxRate: 0, unitCostRef: 2 },
      ]);
    },
  );

  it("un producto que no existe o nunca se compró no es un error: no aparece", async () => {
    expect(await lastCosts("?supplierId=cont-supplier&productIds=no-existe,prod-drill")).toEqual([]);
  });

  it("admite 50 productos y rechaza 51", async () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `prod-lote-${index}`).join(",");

    const allowed = await get(`?supplierId=cont-supplier&productIds=${ids(50)}`);
    const tooMany = await get(`?supplierId=cont-supplier&productIds=${ids(51)}`);

    expect(allowed.status).toBe(200);
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error.code).toBe("BAD_REQUEST");
  });

  it.each([
    [""],
    ["?supplierId=cont-supplier"],
    ["?productIds=prod-cable"],
    ["?supplierId=&productIds=prod-cable"],
    ["?supplierId=cont-supplier&productIds="],
    ["?supplierId=con%20espacios&productIds=prod-cable"],
    ["?supplierId=..%2Fproducts&productIds=prod-cable"],
    [`?supplierId=${"a".repeat(65)}&productIds=prod-cable`],
    ["?supplierId=cont-supplier&productIds=prod-cable,"],
    ["?supplierId=cont-supplier&productIds=prod-cable,,prod-drill"],
    ["?supplierId=cont-supplier&productIds=prod%20cable"],
    ["?supplierId=cont-supplier&productIds=prod-cable%00"],
    ["?supplierId=cont-supplier&productIds=prod-cable;drop"],
    [`?supplierId=cont-supplier&productIds=${"a".repeat(65)}`],
  ])("responde 400 con parámetros inválidos (%s)", async (query) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
