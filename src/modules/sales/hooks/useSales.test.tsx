import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
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
});
