import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useKeepProductPrice, useRepriceProducts } from "./usePriceReview";
import { productsQueryKeys, useUpdateProductPrice } from "./useProducts";

/**
 * PRO-F9 · los hooks de precio envían el costo que el usuario vio y, ante el
 * 409 "el costo cambió", refrescan los datos de productos.
 */

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const COST_CHANGED = {
  error: { code: "CONFLICT", message: "El costo cambió de 10.00 a 14.00; revisa el precio" },
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { invalidate, wrapper: Wrapper };
}

describe("hooks de precio · costo esperado (PRO-F9)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  function sentBody() {
    return JSON.parse(String(fetchMock.mock.calls[0][1].body));
  }

  it("useKeepProductPrice envía expectedCostRef y, ante un 409, deja el mensaje y refresca productos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(COST_CHANGED, 409));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useKeepProductPrice(), { wrapper });

    result.current.mutate({ expectedCostRef: 10, productId: "prod-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/products/prod-1/keep-price");
    expect(sentBody()).toEqual({ expectedCostRef: 10 });
    expect(result.current.error?.message).toBe("El costo cambió de 10.00 a 14.00; revisa el precio");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productsQueryKeys.all });
  });

  it("useKeepProductPrice no refresca nada ante un error que no es 409", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "FORBIDDEN", message: "No autorizado" } }, 403));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useKeepProductPrice(), { wrapper });

    result.current.mutate({ expectedCostRef: 10, productId: "prod-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("useUpdateProductPrice envía expectedCostRef y, ante un 409, refresca productos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(COST_CHANGED, 409));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUpdateProductPrice("prod-1"), { wrapper });

    result.current.mutate({ expectedCostRef: 10, reason: "Reprecio al 30 %", salePriceRef: 13 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/products/prod-1/price");
    expect(sentBody()).toEqual({ expectedCostRef: 10, reason: "Reprecio al 30 %", salePriceRef: 13 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productsQueryKeys.all });
  });

  it("useRepriceProducts envía items con el costo de cada producto y devuelve la fila COST_CHANGED", async () => {
    const data = {
      failed: 1,
      results: [
        { code: "COST_CHANGED", message: "El costo cambió de 12.00 a 20.00; revisa el precio", productId: "prod-1", status: "error" },
        { productId: "prod-2", salePriceRef: 11.7, status: "ok" },
      ],
      updated: 1,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ data }));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRepriceProducts(), { wrapper });
    const items = [
      { expectedCostRef: 12, productId: "prod-1" },
      { expectedCostRef: 9, productId: "prod-2" },
    ];

    result.current.mutate({ items, markupPct: 30 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(sentBody()).toEqual({ items, markupPct: 30 });
    expect(result.current.data).toEqual(data);
    // El lote terminó: se refresca también para las filas que no cambiaron.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productsQueryKeys.all });
  });
});
