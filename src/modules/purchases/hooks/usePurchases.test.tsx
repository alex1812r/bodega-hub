import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useCancelPurchase,
  useCreatePurchase,
  usePurchase,
  usePurchases,
  useReturnPurchase,
  useSupplierProducts,
} from "./usePurchases";

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

describe("purchase hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads purchases with filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "purchase-001", purchaseNumber: "C-000001" }]) }),
    );

    const { result } = renderHook(
      () =>
        usePurchases({
          from: "2026-05-01",
          status: "pedido",
          supplierId: "cont-supplier",
          to: "2026-05-20",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/purchases?from=2026-05-01&status=pedido&supplierId=cont-supplier&to=2026-05-20",
      expect.any(Object),
    );
  });

  it("loads purchase detail and supplier products", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "purchase-001" } }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "supp-prod-cable" }]) }));

    const purchase = renderHook(() => usePurchase("purchase-001"), {
      wrapper: createWrapper(),
    });
    const supplierProducts = renderHook(() => useSupplierProducts("cont-supplier"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(purchase.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(supplierProducts.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/purchases/purchase-001", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/suppliers/cont-supplier/products",
      expect.any(Object),
    );
  });

  it("creates, cancels and returns purchases", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "purchase-new" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "purchase-001", status: "cancelado" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            purchase: { id: "purchase-001", status: "devuelto" },
            stockMovements: [],
          },
        }),
      );

    const createPurchase = renderHook(() => useCreatePurchase(), {
      wrapper: createWrapper(),
    });
    const cancelPurchase = renderHook(() => useCancelPurchase("purchase-001"), {
      wrapper: createWrapper(),
    });
    const returnPurchase = renderHook(() => useReturnPurchase("purchase-001"), {
      wrapper: createWrapper(),
    });

    createPurchase.result.current.mutate({
      items: [{ productId: "prod-cable", quantity: 2, unitCostRef: 2 }],
      supplierId: "cont-supplier",
    });
    await waitFor(() => expect(createPurchase.result.current.isSuccess).toBe(true));

    cancelPurchase.result.current.mutate("purchase-001");
    await waitFor(() => expect(cancelPurchase.result.current.isSuccess).toBe(true));

    returnPurchase.result.current.mutate("purchase-001");
    await waitFor(() => expect(returnPurchase.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/purchases",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/purchases/purchase-001/cancel",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/purchases/purchase-001/return",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
