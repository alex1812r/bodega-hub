import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import {
  fetchPurchaseLastCosts,
  withLastPurchaseCost,
  withLastPurchaseCosts,
} from "./purchaseLastCosts";
import type { PurchaseProductResolutions } from "./resolvePurchaseProducts";
import { resolvePurchaseProductByCode } from "./resolveSupplierCatalogProduct";

/** COM-F11 · cliente de `GET /api/purchases/last-costs`. */

function product(productId: string): PurchaseCatalogProduct {
  return {
    costWithTaxRef: 11.6,
    currentStock: 0,
    link: "none",
    name: productId,
    packUnits: [],
    productId,
    sku: productId,
    taxRate: 16,
    unitCostRef: 10,
  };
}

/**
 * Responde los últimos costos de los ids pedidos que estén en `known` (o un fallo de red
 * con `known = null`); el Taladro existe por código y el proveedor no tiene vínculos.
 */
function installApi(known: Record<string, number> | null) {
  const requests: URLSearchParams[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");

    if (url.pathname === "/api/products") {
      const row = {
        barcode: "7501234567890",
        category: { taxRate: 16 },
        currentCostRef: 2494.41,
        id: "prod-drill",
        isActive: true,
        name: "Taladro",
        sku: "ELE-TAL-001",
      };

      return jsonResponse({ data: { items: [row], limit: 2, skip: 0, total: 1 } });
    }

    if (url.pathname.startsWith("/api/suppliers/")) {
      return jsonResponse({ data: { items: [], limit: 20, skip: 0, total: 0 } });
    }

    requests.push(url.searchParams);

    if (!known) {
      throw new TypeError("Failed to fetch");
    }

    const ids = (url.searchParams.get("productIds") ?? "").split(",");

    return jsonResponse({
      data: ids.flatMap((productId) =>
        productId in known
          ? [{ productId, source: "supplier", taxRate: 0, unitCostRef: known[productId] }]
          : [],
      ),
    });
  }) as unknown as typeof fetch;

  return requests;
}

describe("fetchPurchaseLastCosts", () => {
  it("pide proveedor e ids en una sola petición y devuelve los costos por producto", async () => {
    const requests = installApi({ "prod-a": 2494.41 });

    const costs = await fetchPurchaseLastCosts("cont-supplier", ["prod-a", "prod-b", "prod-a"]);

    expect(requests).toHaveLength(1);
    expect(requests[0].get("supplierId")).toBe("cont-supplier");
    expect(requests[0].get("productIds")).toBe("prod-a,prod-b");
    expect([...costs.keys()]).toEqual(["prod-a"]);
    expect(costs.get("prod-a")).toMatchObject({ source: "supplier", unitCostRef: 2494.41 });
  });

  it("reparte más de 50 productos en peticiones de 50", async () => {
    const requests = installApi({ "prod-119": 7 });
    const ids = Array.from({ length: 120 }, (_, index) => `prod-${index}`);

    const costs = await fetchPurchaseLastCosts("cont-supplier", ids);

    expect(requests.map((params) => (params.get("productIds") ?? "").split(",").length)).toEqual([
      50, 50, 20,
    ]);
    expect(costs.get("prod-119")?.unitCostRef).toBe(7);
  });

  it("sin productos no pide nada", async () => {
    const requests = installApi({});

    expect((await fetchPurchaseLastCosts("cont-supplier", [])).size).toBe(0);
    expect(requests).toHaveLength(0);
  });
});

describe("withLastPurchaseCost / withLastPurchaseCosts", () => {
  it("un producto ya comprado sale con su último neto; uno nunca comprado, con el cálculo actual", async () => {
    installApi({ "prod-a": 2494.41 });

    const bought = await withLastPurchaseCost("cont-supplier", product("prod-a"));
    const neverBought = await withLastPurchaseCost("cont-supplier", product("prod-b"));

    expect(bought.unitCostRef).toBe(2494.41);
    expect(neverBought.unitCostRef).toBe(10);
  });

  it("duplicar: una petición para todos los productos activos; los no disponibles no se piden", async () => {
    const requests = installApi({ "prod-a": 2494.41 });
    const resolutions: PurchaseProductResolutions = new Map([
      ["prod-a", { product: product("prod-a"), status: "active" }],
      ["prod-b", { product: product("prod-b"), status: "active" }],
      ["prod-x", { name: "Descontinuado", status: "unavailable" }],
    ]);

    const resolved = await withLastPurchaseCosts("cont-supplier", resolutions);

    expect(requests).toHaveLength(1);
    expect(requests[0].get("productIds")).toBe("prod-a,prod-b");
    expect(resolved.get("prod-a")).toMatchObject({
      product: { lastPurchaseUnitCostRef: 2494.41, unitCostRef: 2494.41 },
      status: "active",
    });
    expect(resolved.get("prod-b")).toMatchObject({ product: { unitCostRef: 10 }, status: "active" });
    expect(resolved.get("prod-x")).toEqual({ name: "Descontinuado", status: "unavailable" });
  });

  it("duplicar sin productos activos no pide nada", async () => {
    const requests = installApi({});
    const resolutions: PurchaseProductResolutions = new Map([
      ["prod-x", { name: null, status: "unavailable" }],
    ]);

    await withLastPurchaseCosts("cont-supplier", resolutions);

    expect(requests).toHaveLength(0);
  });
});

describe("resolvePurchaseProductByCode", () => {
  it("un escaneo sale con el último neto del producto, no con su costo entre la alícuota de la categoría", async () => {
    const requests = installApi({ "prod-drill": 2494.41 });

    const resolution = await resolvePurchaseProductByCode("cont-supplier", "7501234567890");

    expect(resolution).toMatchObject({
      product: { productId: "prod-drill", taxRate: 16, unitCostRef: 2494.41 },
      status: "found",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].get("productIds")).toBe("prod-drill");
  });

  it("si no se puede leer el último costo, el escaneo falla en vez de sugerir otro costo", async () => {
    installApi(null);

    await expect(resolvePurchaseProductByCode("cont-supplier", "7501234567890")).rejects.toThrow(
      "Failed to fetch",
    );
  });
});
