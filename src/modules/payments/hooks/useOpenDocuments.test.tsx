import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { openDocumentsQueryKeys, useOpenDocuments, type OpenDocument } from "./useOpenDocuments";
import { paymentsQueryKeys } from "./usePayments";

const document: OpenDocument = {
  contact: { id: "cont-both", name: "Comercial Doble Via", taxId: "J-00000003-3" },
  createdAt: "2026-05-18T15:10:00.000Z",
  id: "sale-002",
  number: "V-000002",
  paidVes: 3000,
  pendingRef: 16.62,
  pendingVes: 8475,
  refRateVes: 510,
  status: "pendiente_pago",
  totalRef: 22.5,
  totalVes: 11475,
  type: "sale",
};

function listPayload(items: OpenDocument[]) {
  return {
    data: {
      items,
      limit: 10,
      skip: 0,
      total: items.length,
      totals: { count: items.length, pendingRef: 16.62, pendingVes: 8475, truncated: false },
    },
  };
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
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { queryClient, Wrapper };
}

describe("useOpenDocuments", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads open documents sending every filter in the query string", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(listPayload([document])));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useOpenDocuments({
          contactId: "cont-both",
          from: "2026-05-01",
          limit: 20,
          olderThanDays: 7,
          search: "V-000002",
          skip: 0,
          to: "2026-05-31",
          type: "sale",
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.items).toEqual([document]);
    expect(result.current.data?.totals).toEqual({
      count: 1,
      pendingRef: 16.62,
      pendingVes: 8475,
      truncated: false,
    });

    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/api/payments/open-documents");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      contactId: "cont-both",
      from: "2026-05-01",
      limit: "20",
      olderThanDays: "7",
      search: "V-000002",
      skip: "0",
      to: "2026-05-31",
      type: "sale",
    });
  });

  it("omits empty filters from the request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(listPayload([])));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useOpenDocuments({ search: "", type: undefined }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock.mock.calls[0][0]).toBe("/api/payments/open-documents");
  });

  it("does not fetch while disabled", () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useOpenDocuments({ type: "sale" }, { enabled: false }), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "No tienes permiso para acceder a pagos de compras." } },
        403,
      ),
    );
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useOpenDocuments({ type: "purchase" }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toMatchObject({
      code: "FORBIDDEN",
      message: "No tienes permiso para acceder a pagos de compras.",
      status: 403,
    });
  });

  it("keys the query under payments so invalidating the payments module refetches it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listPayload([document])));
    const { queryClient, Wrapper } = createWrapper();
    const filters = { type: "sale" as const };

    expect(openDocumentsQueryKeys.list(filters)).toEqual(["payments", "open-documents", filters]);

    const { result } = renderHook(() => useOpenDocuments(filters), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: paymentsQueryKeys.all });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
