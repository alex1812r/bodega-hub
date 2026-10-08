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

  describe("PAG-01a: idempotencia e invalidacion de caja y baul", () => {
    function createClientWrapper() {
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
      });
      const invalidate = jest.spyOn(queryClient, "invalidateQueries");

      function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      return {
        invalidatedKeys: () => invalidate.mock.calls.map(([filters]) => filters?.queryKey),
        Wrapper,
      };
    }

    it("envia el clientRequestId en el cuerpo del POST", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "pay-new" } }, 201));

      const { Wrapper } = createClientWrapper();
      const { result } = renderHook(() => useCreatePayment(), { wrapper: Wrapper });

      result.current.mutate({
        amount: 100,
        clientRequestId: "attempt-1",
        currency: "VES",
        method: "efectivo_ves",
        purchaseId: "purchase-002",
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
        amount: 100,
        clientRequestId: "attempt-1",
        currency: "VES",
        method: "efectivo_ves",
        purchaseId: "purchase-002",
      });
    });

    it("al registrar un pago invalida caja y baul ademas de los documentos", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "pay-new" } }, 201));

      const { invalidatedKeys, Wrapper } = createClientWrapper();
      const { result } = renderHook(() => useCreatePayment(), { wrapper: Wrapper });

      result.current.mutate({ amount: 100, method: "efectivo_ves", saleId: "sale-002" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidatedKeys()).toEqual(
        expect.arrayContaining([["sales"], ["purchases"], ["contacts"], ["cash"], ["vault"]]),
      );
    });

    it("PAG-F5: el pago nuevo aparece de inmediato en la lista y ademas la lista se revalida", async () => {
      // El alta en Supabase devuelve la fila sin `contact` ni `relatedDocument`:
      // la insercion optimista la muestra al instante y el refetch la completa.
      const created = { createdAt: "2026-05-18T14:30:00.000Z", id: "pay-new", saleId: "sale-002" };
      const complete = { ...created, contact: { id: "cont-customer", name: "Cliente" } };
      let resolveRefetch: (response: Response) => void = () => undefined;

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "pay-001" }]) }))
        .mockResolvedValueOnce(jsonResponse({ data: created }, 201))
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveRefetch = resolve;
            }),
        );

      const { invalidatedKeys, Wrapper } = createClientWrapper();
      const { result } = renderHook(
        () => ({ create: useCreatePayment(), list: usePayments() }),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
      result.current.create.mutate({ amount: 100, method: "efectivo_ves", saleId: "sale-002" });

      // Antes de que responda el refetch la fila ya esta, tal como la devolvio el alta.
      await waitFor(() =>
        expect(result.current.list.data?.items.map((item) => item.id)).toEqual([
          "pay-new",
          "pay-001",
        ]),
      );
      expect(result.current.list.data?.total).toBe(2);
      expect(invalidatedKeys()).toContainEqual(["payments"]);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(fetchMock.mock.calls[2][0]).toBe("/api/payments");

      resolveRefetch(jsonResponse({ data: paginated([complete, { id: "pay-001" }]) }));

      await waitFor(() =>
        expect(result.current.list.data?.items[0].contact?.name).toBe("Cliente"),
      );
    });

    it("si el servidor rechaza el pago no invalida nada", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "BAD_REQUEST", message: "Rechazado." } }, 400),
      );

      const { invalidatedKeys, Wrapper } = createClientWrapper();
      const { result } = renderHook(() => useCreatePayment(), { wrapper: Wrapper });

      result.current.mutate({ amount: 100, method: "efectivo_ves", saleId: "sale-002" });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(invalidatedKeys()).toEqual([]);
    });

    it("al anular un pago invalida caja y baul", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { id: "pay-001", status: "anulado" } }),
      );

      const { invalidatedKeys, Wrapper } = createClientWrapper();
      const { result } = renderHook(() => useCancelPayment("pay-001"), { wrapper: Wrapper });

      result.current.mutate("pay-001");

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidatedKeys()).toEqual(
        expect.arrayContaining([["payments"], ["sales"], ["purchases"], ["cash"], ["vault"]]),
      );
    });
  });
});
