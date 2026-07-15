import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useCancelPayment, useCreatePayment, usePayment, usePayments } from "./usePayments";

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

describe("payments hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads payments with filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: paginated([{ id: "pay-001", saleId: "sale-001" }]) }),
    );

    const { result } = renderHook(
      () =>
        usePayments({
          contactId: "cont-customer",
          direction: "entrada",
          purchaseId: "purchase-001",
          saleId: "sale-001",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments?contactId=cont-customer&direction=entrada&purchaseId=purchase-001&saleId=sale-001",
      expect.any(Object),
    );
  });

  it("loads payment detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "pay-001" } }));

    const { result } = renderHook(() => usePayment("pay-001"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/payments/pay-001", expect.any(Object));
  });

  it("creates a contextual payment", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 0 } }, 201),
    );

    const { result } = renderHook(() => useCreatePayment(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      amount: 2500,
      bankName: "Banco Nacional",
      currency: "VES",
      method: "pago_movil",
      phone: "04120000000",
      referenceCode: "1234",
      saleId: "sale-002",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cancels a payment", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { id: "pay-001", status: "anulado" } }),
    );

    const { result } = renderHook(() => useCancelPayment("pay-001"), {
      wrapper: createWrapper(),
    });

    result.current.mutate("pay-001");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments/pay-001/cancel",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
