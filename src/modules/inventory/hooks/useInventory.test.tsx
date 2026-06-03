import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useAdjustInventory,
  useInventory,
  useInventoryMovements,
  useStockCard,
} from "./useInventory";

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

describe("inventory hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads inventory with low stock filter", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "prod-cable", currentStock: 4 }]) }),
    );

    const { result } = renderHook(() => useInventory({ lowStock: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inventory?lowStock=true",
      expect.any(Object),
    );
  });

  it("loads movements and stock card by product", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "mov-001" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "mov-002" }]) }));

    const movements = renderHook(
      () => useInventoryMovements({ productId: "prod-cable" }),
      { wrapper: createWrapper() },
    );
    const stockCard = renderHook(
      () => useStockCard({ productId: "prod-cable" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(movements.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(stockCard.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inventory/movements?productId=prod-cable",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inventory/stock-card?productId=prod-cable",
      expect.any(Object),
    );
  });

  it("creates inventory adjustments", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { id: "mov-new", type: "ajuste_salida" } }, 201),
    );

    const adjustment = renderHook(() => useAdjustInventory(), {
      wrapper: createWrapper(),
    });

    adjustment.result.current.mutate({
      productId: "prod-cable",
      quantityDelta: -2,
      reason: "Conteo fisico",
      type: "ajuste_salida",
    });

    await waitFor(() => expect(adjustment.result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inventory/adjustments",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces negative stock adjustment errors", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "BAD_REQUEST",
            message: "El ajuste no puede dejar stock negativo.",
          },
        },
        400,
      ),
    );

    const adjustment = renderHook(() => useAdjustInventory(), {
      wrapper: createWrapper(),
    });

    adjustment.result.current.mutate({
      productId: "prod-cable",
      quantityDelta: -99,
      type: "ajuste_salida",
    });

    await waitFor(() => expect(adjustment.result.current.isError).toBe(true));
    expect(adjustment.result.current.error?.message).toBe(
      "El ajuste no puede dejar stock negativo.",
    );
  });
});
