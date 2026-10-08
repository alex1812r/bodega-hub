import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  priceReviewQueryKeys,
  useKeepProductPrice,
  usePriceReview,
  usePriceReviewSummary,
  useRepriceProducts,
} from "./usePriceReview";
import { productsQueryKeys } from "./useProducts";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { invalidate, wrapper: Wrapper };
}

describe("price review hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("keeps its query keys under the products key, so any product change refreshes the queue", () => {
    expect(priceReviewQueryKeys.list({ purchaseId: "pur-1" }).slice(0, productsQueryKeys.all.length)).toEqual([
      ...productsQueryKeys.all,
    ]);
    expect(priceReviewQueryKeys.summary().slice(0, productsQueryKeys.all.length)).toEqual([
      ...productsQueryKeys.all,
    ]);
  });

  it("loads the queue with pagination and the purchase filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [], limit: 20, skip: 0, total: 0 } }));

    const { result } = renderHook(() => usePriceReview({ limit: 20, purchaseId: "pur-1", skip: 0 }), {
      wrapper: setup().wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products/price-review?limit=20&purchaseId=pur-1&skip=0",
      expect.any(Object),
    );
  });

  it("loads the summary and does not fetch while disabled", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { total: 3 } }));
    const { wrapper } = setup();

    const disabled = renderHook(() => usePriceReviewSummary({ enabled: false }), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();

    const { result } = renderHook(() => usePriceReviewSummary(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ total: 3 }));
    expect(fetchMock).toHaveBeenCalledWith("/api/products/price-review/summary", expect.any(Object));
  });

  it("keeps the price of a product and refreshes everything under products", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { history: { kind: "keep" }, product: { id: "prod-1" } } }));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useKeepProductPrice(), { wrapper });

    result.current.mutate({ productId: "prod-1", reason: "Lo reviso el lunes" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/products/prod-1/keep-price");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Lo reviso el lunes" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productsQueryKeys.all });
  });

  it("reprices the selection and returns the per-product results", async () => {
    const data = {
      failed: 1,
      results: [
        { productId: "prod-1", salePriceRef: 11.25, status: "ok" },
        { code: "NO_COST", message: "Sin costo", productId: "prod-2", status: "error" },
      ],
      updated: 1,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ data }));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRepriceProducts(), { wrapper });

    result.current.mutate({ markupPct: 25, productIds: ["prod-1", "prod-2"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/products/price-review/reprice");
    expect(JSON.parse(String(init.body))).toEqual({ markupPct: 25, productIds: ["prod-1", "prod-2"] });
    expect(result.current.data).toEqual(data);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productsQueryKeys.all });
  });
});
