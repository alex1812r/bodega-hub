import { act, renderHook } from "@testing-library/react";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";

import { usePosCart } from "./usePosCart";

function product(overrides: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    barcode: "7501000000001",
    categoryId: "cat-1",
    categoryName: "Abarrotes",
    currentStock: 10,
    id: "prod-1",
    imageUrl: null,
    isActive: true,
    minStock: 2,
    name: "Harina PAN",
    salePriceRef: 1.5,
    sku: "SKU-1",
    ...overrides,
  } as ProductWithCategory;
}

describe("usePosCart", () => {
  it("adds a new line the first time a product is selected", () => {
    const { result } = renderHook(() => usePosCart());

    act(() => {
      result.current.addProduct(product());
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      productId: "prod-1",
      quantity: 1,
    });
  });

  it("increments quantity when the same product is scanned or selected again", () => {
    const { result } = renderHook(() => usePosCart());

    act(() => {
      result.current.addProduct(product());
      result.current.addProduct(product());
      result.current.addProduct(product(), 2);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.quantity).toBe(4);
    expect(result.current.itemsCount).toBe(4);
  });

  it("does not exceed available stock when incrementing via scan/select", () => {
    const { result } = renderHook(() => usePosCart());

    act(() => {
      result.current.addProduct(product({ currentStock: 3 }));
      result.current.addProduct(product({ currentStock: 3 }), 5);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.quantity).toBe(3);
  });
});
