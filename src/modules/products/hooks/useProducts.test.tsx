import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useCategories,
  useCreateProduct,
  useProduct,
  useProductPriceHistory,
  useProducts,
  useProductSuppliers,
  useUpdateProduct,
  useUpdateProductPrice,
} from "./useProducts";

function paginated<T>(items: T[]) {
  return { items, limit: 10, skip: 0, total: items.length };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return Wrapper;
}

describe("product hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads products with filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "prod-drill", name: "Taladro" }]) }),
    );

    const { result } = renderHook(
      () => useProducts({ categoryId: "cat-tools", isActive: true, search: "taladro" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products?categoryId=cat-tools&isActive=true&search=taladro",
      expect.any(Object),
    );
  });

  it("loads products with skip and limit", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "prod-drill", name: "Taladro" }]) }),
    );

    const { result } = renderHook(
      () => useProducts({ limit: 25, skip: 20 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products?limit=25&skip=20",
      expect.any(Object),
    );
  });

  it("loads products with sort params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "prod-drill", name: "Taladro" }]) }),
    );

    const { result } = renderHook(
      () => useProducts({ sortBy: "currentStock", sortOrder: "desc" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products?sortBy=currentStock&sortOrder=desc",
      expect.any(Object),
    );
  });

  it("loads product detail, categories, price history and suppliers", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "prod-drill" } }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "cat-tools" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "price-001" }]) }))
      .mockResolvedValueOnce(
        jsonResponse({ data: paginated([{ id: "supplier-product-001" }]) }),
      );

    const product = renderHook(() => useProduct("prod-drill"), {
      wrapper: createWrapper(),
    });
    const categories = renderHook(() => useCategories(), {
      wrapper: createWrapper(),
    });
    const history = renderHook(() => useProductPriceHistory("prod-drill"), {
      wrapper: createWrapper(),
    });
    const suppliers = renderHook(() => useProductSuppliers("prod-drill"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(product.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(categories.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(history.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(suppliers.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/products/prod-drill", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith("/api/categories", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products/prod-drill/price-history",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products/prod-drill/suppliers",
      expect.any(Object),
    );
  });

  it("creates, updates and changes product price", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "prod-new" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "prod-drill" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            history: { id: "price-new" },
            product: { id: "prod-drill" },
          },
        }),
      );

    const createProduct = renderHook(() => useCreateProduct(), {
      wrapper: createWrapper(),
    });
    const updateProduct = renderHook(() => useUpdateProduct("prod-drill"), {
      wrapper: createWrapper(),
    });
    const updatePrice = renderHook(() => useUpdateProductPrice("prod-drill"), {
      wrapper: createWrapper(),
    });

    createProduct.result.current.mutate({
      categoryId: "cat-tools",
      name: "Producto nuevo",
      salePriceRef: 10,
      sku: "NEW-001",
    });
    await waitFor(() => expect(createProduct.result.current.isSuccess).toBe(true));

    updateProduct.result.current.mutate({ name: "Producto editado" });
    await waitFor(() => expect(updateProduct.result.current.isSuccess).toBe(true));

    updatePrice.result.current.mutate({ salePriceRef: 12 });
    await waitFor(() => expect(updatePrice.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products/prod-drill",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products/prod-drill/price",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
