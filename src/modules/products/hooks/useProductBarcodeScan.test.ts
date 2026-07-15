jest.mock("../../../shared/api/apiFetch", () => ({
  apiFetch: jest.fn(),
}));

import { fetchProductByBarcode } from "./useProductBarcodeScan";

const { apiFetch } = jest.requireMock<{ apiFetch: jest.Mock }>(
  "../../../shared/api/apiFetch",
);

describe("fetchProductByBarcode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no products match", async () => {
    apiFetch.mockResolvedValue({ items: [], limit: 2, skip: 0, total: 0 });

    await expect(fetchProductByBarcode("999")).resolves.toBeNull();
  });

  it("returns the product when exactly one matches", async () => {
    const product = { id: "prod-1", name: "Harina", sku: "har-001" };
    apiFetch.mockResolvedValue({
      items: [product],
      limit: 2,
      skip: 0,
      total: 1,
    });

    await expect(fetchProductByBarcode("7501234567890")).resolves.toEqual(product);
  });

  it("throws when multiple products match", async () => {
    apiFetch.mockResolvedValue({
      items: [{ id: "a" }, { id: "b" }],
      limit: 2,
      skip: 0,
      total: 2,
    });

    await expect(fetchProductByBarcode("7501234567890")).rejects.toThrow(
      "MULTIPLE_BARCODE_MATCHES",
    );
  });
});
