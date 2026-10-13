import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  invalidateAfterSaleRegistered,
  useCancelSale,
  useCreateSale,
  useReturnSale,
  useSale,
  useSaleReceipt,
  useSales,
} from "./useSales";

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

describe("sales hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads sales with filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "sale-001", invoiceNumber: "V-000001" }]) }),
    );

    const { result } = renderHook(
      () =>
        useSales({
          customerId: "cont-customer",
          from: "2026-05-01",
          status: "pagada",
          to: "2026-05-20",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales?customerId=cont-customer&from=2026-05-01&status=pagada&to=2026-05-20",
      expect.any(Object),
    );
  });

  it("loads sale detail and receipt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "sale-001" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { saleId: "sale-001" } }));

    const sale = renderHook(() => useSale("sale-001"), {
      wrapper: createWrapper(),
    });
    const receipt = renderHook(() => useSaleReceipt("sale-001"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(sale.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(receipt.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/sales/sale-001", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales/sale-001/receipt",
      expect.any(Object),
    );
  });

  it("creates, cancels and returns sales", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "sale-new" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "sale-002" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { sale: { id: "sale-002" }, stockMovements: [] } }),
      );

    const createSale = renderHook(() => useCreateSale(), {
      wrapper: createWrapper(),
    });
    const cancelSale = renderHook(() => useCancelSale("sale-002"), {
      wrapper: createWrapper(),
    });
    const returnSale = renderHook(() => useReturnSale("sale-002"), {
      wrapper: createWrapper(),
    });

    createSale.result.current.mutate({
      customerId: "cont-customer",
      items: [{ productId: "prod-drill", quantity: 1 }],
      refRateVes: 510,
    });
    await waitFor(() => expect(createSale.result.current.isSuccess).toBe(true));

    cancelSale.result.current.mutate("sale-002");
    await waitFor(() => expect(cancelSale.result.current.isSuccess).toBe(true));

    returnSale.result.current.mutate("sale-002");
    await waitFor(() => expect(returnSale.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales/sale-002/cancel",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales/sale-002/return",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("never retries a failed sale on its own, even if the client retries mutations by default", async () => {
    // C3: la respuesta pudo perderse tras el commit; reenviar a ciegas duplica la venta.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: 2, retryDelay: 0 }, queries: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const createSale = renderHook(() => useCreateSale(), { wrapper: Wrapper });
    createSale.result.current.mutate({
      clientRequestId: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
      customerId: "cont-customer",
      items: [{ productId: "prod-drill", quantity: 1 }],
    });

    await waitFor(() => expect(createSale.result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates sales, stock and movements when a sale is confirmed outside the mutation", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    invalidateAfterSaleRegistered(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sales"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["products"] });
    // `inventory` es el prefijo de existencias, movimientos y kardex.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["inventory"] });
  });

  it("POS-F8: una venta registrada deja obsoleto todo el dinero de caja en caché (sesión, movimientos, turnos abiertos)", () => {
    // «Mi caja» montaba con la caché de antes de la venta: cajón 0 y cierre prellenado con 0.
    const queryClient = new QueryClient();
    const cashQueryKeys = [
      ["cash", "session"],
      ["cash", "movements", "session-1"],
      ["cash", "open-sessions"],
      ["cash", "registers"],
    ];

    for (const queryKey of cashQueryKeys) {
      queryClient.setQueryData(queryKey, { cached: true });
    }

    invalidateAfterSaleRegistered(queryClient);

    for (const queryKey of cashQueryKeys) {
      expect([queryKey, queryClient.getQueryState(queryKey)?.isInvalidated]).toEqual([queryKey, true]);
    }
  });

  it("POS-F8: devolver una venta anula sus pagos y con ellos el efectivo del cajón: invalida caja", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { sale: { id: "sale-002" }, stockMovements: [] } }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    queryClient.setQueryData(["cash", "movements", "session-1"], { cached: true });

    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const returnSale = renderHook(() => useReturnSale("sale-002"), { wrapper: Wrapper });

    returnSale.result.current.mutate("sale-002");
    await waitFor(() => expect(returnSale.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(["cash", "movements", "session-1"])?.isInvalidated).toBe(true);
  });

  it("invalidates the products catalog after selling, cancelling and returning", async () => {
    // El POS cachea el catalogo 5 min: si la venta no invalida `products`, el
    // cajero sigue viendo el stock anterior y puede intentar vender lo que ya no hay.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "sale-new" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "sale-002" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { sale: { id: "sale-002" }, stockMovements: [] } }),
      );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const createSale = renderHook(() => useCreateSale(), { wrapper: Wrapper });
    createSale.result.current.mutate({
      customerId: "cont-customer",
      items: [{ productId: "prod-drill", quantity: 1 }],
      refRateVes: 510,
    });
    await waitFor(() => expect(createSale.result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["products"] });

    invalidateSpy.mockClear();
    const cancelSale = renderHook(() => useCancelSale("sale-002"), { wrapper: Wrapper });
    cancelSale.result.current.mutate("sale-002");
    await waitFor(() => expect(cancelSale.result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["products"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["inventory"] });

    invalidateSpy.mockClear();
    const returnSale = renderHook(() => useReturnSale("sale-002"), { wrapper: Wrapper });
    returnSale.result.current.mutate("sale-002");
    await waitFor(() => expect(returnSale.result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["products"] });
  });
});
