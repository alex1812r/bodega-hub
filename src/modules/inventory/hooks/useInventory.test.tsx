import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  inventoryQueryKeys,
  useAdjustInventory,
  useConvertPackToUnits,
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

  it("does not ask for movements while the query is disabled", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: paginated([{ id: "mov-001" }]) }));

    const movements = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useInventoryMovements({ from: "2026-10-05", to: "2026-10-01" }, enabled),
      { initialProps: { enabled: false }, wrapper: createWrapper() },
    );

    expect(movements.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();

    movements.rerender({ enabled: true });

    await waitFor(() => expect(movements.result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates inventory adjustments", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { id: "mov-new", type: "ajuste_salida" } }, 201),
    );

    const adjustment = renderHook(() => useAdjustInventory(), {
      wrapper: createWrapper(),
    });

    adjustment.result.current.mutate({
      clientRequestId: "5b0c1a52-1111-4222-8333-444455556666",
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
      clientRequestId: "5b0c1a52-1111-4222-8333-444455556666",
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

/**
 * INV-F4 · R1: si no se sabe si el movimiento se registró (sin respuesta, 5xx o
 * 408), el stock en caché puede ser viejo; se invalida lo mismo que tras el éxito.
 */
describe("stock mutations · invalidación tras un error (INV-F4 · R1)", () => {
  const fetchMock = jest.fn();
  const adjustment = {
    clientRequestId: "5b0c1a52-1111-4222-8333-444455556666",
    productId: "prod-cable",
    quantityDelta: 1,
  };
  const conversion = {
    clientRequestId: "5b0c1a52-1111-4222-8333-444455556667",
    packProductId: "prod-pack",
    packQuantity: 1,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");

    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    return { invalidate, Wrapper };
  }

  function errorResponse(status: number) {
    return jsonResponse({ error: { code: "ERROR", message: "Mensaje del servidor." } }, status);
  }

  const uncertain: [string, () => void][] = [
    ["sin respuesta", () => fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ["500", () => fetchMock.mockResolvedValueOnce(errorResponse(500))],
    ["408", () => fetchMock.mockResolvedValueOnce(errorResponse(408))],
  ];
  const definitive: [string, () => void][] = [
    ["400", () => fetchMock.mockResolvedValueOnce(errorResponse(400))],
    ["409", () => fetchMock.mockResolvedValueOnce(errorResponse(409))],
  ];

  it.each(uncertain)(
    "ajuste con resultado incierto (%s): invalida inventario y productos",
    async (_, arrange) => {
      arrange();
      const { invalidate, Wrapper } = setup();
      const { result } = renderHook(() => useAdjustInventory(), { wrapper: Wrapper });

      result.current.mutate(adjustment);

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: inventoryQueryKeys.all });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["products"] });
    },
  );

  it.each(definitive)("ajuste rechazado (%s): no invalida nada", async (_, arrange) => {
    arrange();
    const { invalidate, Wrapper } = setup();
    const { result } = renderHook(() => useAdjustInventory(), { wrapper: Wrapper });

    result.current.mutate(adjustment);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(uncertain)(
    "conversión con resultado incierto (%s): invalida inventario y productos",
    async (_, arrange) => {
      arrange();
      const { invalidate, Wrapper } = setup();
      const { result } = renderHook(() => useConvertPackToUnits(), { wrapper: Wrapper });

      result.current.mutate(conversion);

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: inventoryQueryKeys.all });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["products"] });
    },
  );

  it.each(definitive)("conversión rechazada (%s): no invalida nada", async (_, arrange) => {
    arrange();
    const { invalidate, Wrapper } = setup();
    const { result } = renderHook(() => useConvertPackToUnits(), { wrapper: Wrapper });

    result.current.mutate(conversion);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("el éxito sigue invalidando inventario y productos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "mov-new" } }, 201));
    const { invalidate, Wrapper } = setup();
    const { result } = renderHook(() => useAdjustInventory(), { wrapper: Wrapper });

    result.current.mutate(adjustment);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: inventoryQueryKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["products"] });
  });
});
