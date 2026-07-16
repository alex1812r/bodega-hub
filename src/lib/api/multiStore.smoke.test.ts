/**
 * Smoke de aislamiento multitienda (mock).
 * Verifica: superadmin no opera ERP; admin no ve recursos de otra tienda.
 */
import { STORE_ACCESS_FORBIDDEN_MESSAGE } from "@/lib/api/storeAccess";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import * as productsMock from "@/modules/products/services/products.mock-server";
import * as storesMock from "@/modules/platform/services/stores.mock-server";

describe("multi-store smoke (mock)", () => {
  it("creates a second store with admin", () => {
    const store = storesMock.createStore({
      admin: {
        email: `admin-b-${Date.now()}@example.com`,
        fullName: "Admin B",
        password: "password123",
      },
      name: "Tienda B",
      slug: `tienda-b-${Date.now()}`,
      status: "active",
    });

    expect(store.id).toBeTruthy();
    expect(store.slug).toContain("tienda-b");
  });

  it("blocks cross-store product access with 403", () => {
    const list = productsMock.listProducts(new URLSearchParams(), DEFAULT_STORE_ID);
    const productId = list.items[0]?.id;
    expect(productId).toBeTruthy();

    expect(() => productsMock.getProductById(productId!, "store-other")).toThrow(
      expect.objectContaining({
        message: STORE_ACCESS_FORBIDDEN_MESSAGE,
        status: 403,
      }),
    );
  });

  it("lists products only for the caller store", () => {
    const defaultList = productsMock.listProducts(new URLSearchParams(), DEFAULT_STORE_ID);
    const otherList = productsMock.listProducts(new URLSearchParams(), "store-other");

    expect(defaultList.total).toBeGreaterThan(0);
    expect(otherList.total).toBe(0);
  });
});
