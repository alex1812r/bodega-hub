/**
 * PAG-05 · `usePayments` envia `method`, `from` y `to`, y `useCreatePayment`
 * refresca los documentos con saldo y no cuela el pago nuevo en una lista
 * filtrada por otro metodo o por otras fechas.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { PaginatedList } from "@/lib/api/pagination";

import { openDocumentsQueryKeys } from "./useOpenDocuments";
import {
  paymentsQueryKeys,
  useCreatePayment,
  usePayments,
  type PaymentListItem,
  type PaymentsFilters,
} from "./usePayments";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

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
    queryClient,
    Wrapper,
  };
}

describe("payments hooks · PAG-05", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("usePayments envia method, from y to en la query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } }),
    );

    const { Wrapper } = createClientWrapper();
    const { result } = renderHook(
      () => usePayments({ from: "2026-10-01", method: "pago_movil", to: "2026-10-06" }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments?from=2026-10-01&method=pago_movil&to=2026-10-06",
      expect.any(Object),
    );
  });

  it("al registrar un pago invalida los documentos con saldo", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "pay-new" } }, 201));

    const { invalidatedKeys, Wrapper } = createClientWrapper();
    const { result } = renderHook(() => useCreatePayment(), { wrapper: Wrapper });

    result.current.mutate({ amount: 100, method: "efectivo_ves", saleId: "sale-002" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Los documentos con saldo cuelgan de la clave de pagos: una sola invalidacion
    // de `["payments"]` los cubre (dos los pedirian dos veces).
    expect(openDocumentsQueryKeys.all).toEqual(["payments", "open-documents"]);
    expect(
      invalidatedKeys().filter((key) => key?.[0] === "payments"),
    ).toEqual([["payments"]]);
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ["sales"],
        ["purchases"],
        ["contacts"],
        ["cash"],
        ["vault"],
      ]),
    );
  });

  it("el pago nuevo solo entra en las listas en cache cuyo metodo y fechas lo admiten", async () => {
    const created = {
      createdAt: "2026-10-06T15:00:00.000Z",
      direction: "entrada",
      id: "pay-new",
      method: "efectivo_ves",
      saleId: "sale-002",
    };
    const cachedLists: Array<{ filters: PaymentsFilters; receivesIt: boolean }> = [
      { filters: {}, receivesIt: true },
      { filters: { method: "efectivo_ves" }, receivesIt: true },
      { filters: { method: "pago_movil" }, receivesIt: false },
      { filters: { from: "2026-10-06", to: "2026-10-06" }, receivesIt: true },
      { filters: { to: "2026-10-05" }, receivesIt: false },
      { filters: { from: "2026-10-07" }, receivesIt: false },
    ];

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: created }, 201));

    const { queryClient, Wrapper } = createClientWrapper();

    for (const { filters } of cachedLists) {
      queryClient.setQueryData<PaginatedList<PaymentListItem>>(paymentsQueryKeys.list(filters), {
        items: [],
        limit: 10,
        skip: 0,
        total: 0,
      });
    }

    const { result } = renderHook(() => useCreatePayment(), { wrapper: Wrapper });

    result.current.mutate({ amount: 100, method: "efectivo_ves", saleId: "sale-002" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    for (const { filters, receivesIt } of cachedLists) {
      const cached = queryClient.getQueryData<PaginatedList<PaymentListItem>>(
        paymentsQueryKeys.list(filters),
      );

      expect({ filters, ids: cached?.items.map((item) => item.id) }).toEqual({
        filters,
        ids: receivesIt ? ["pay-new"] : [],
      });
    }
  });
});
