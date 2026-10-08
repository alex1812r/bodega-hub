import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useAllCategories } from "./useProducts";

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

function category(index: number) {
  return { id: `cat-${index}`, isActive: true, name: `Categoría ${String(index).padStart(3, "0")}` };
}

describe("useAllCategories (PRO-F11)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("pide las categorías con el tope de página y no las 10 por defecto", async () => {
    const all = Array.from({ length: 18 }, (_, index) => category(index));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { items: all, limit: 100, skip: 0, total: 18 } }),
    );

    const { result } = renderHook(() => useAllCategories(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/categories?limit=100&skip=0", expect.any(Object));
    expect(result.current.data?.items).toHaveLength(18);
    expect(result.current.data?.total).toBe(18);
  });

  it("pagina hasta agotar cuando la tienda supera el tope y ordena por nombre", async () => {
    const all = Array.from({ length: 130 }, (_, index) => category(index));
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: { items: all.slice(0, 100).reverse(), limit: 100, skip: 0, total: 130 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { items: all.slice(100), limit: 100, skip: 100, total: 130 } }),
      );

    const { result } = renderHook(() => useAllCategories(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/categories?limit=100&skip=100",
      expect.any(Object),
    );
    expect(result.current.data?.items.map((item) => item.id)).toEqual(
      all.map((item) => item.id),
    );
  });
});
