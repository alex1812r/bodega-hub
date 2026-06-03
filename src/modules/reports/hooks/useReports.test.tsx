import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useCustomerPurchasesReport,
  useDailySalesReport,
  useGrossProfitReport,
  useLowStockReport,
  useProductProfitabilityReport,
  usePurchasesReport,
  useStockCardReport,
  useSupplierPurchasesReport,
  useTopCustomersReport,
  useTopProductsReport,
} from "./useReports";

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

describe("report hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads static report endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ saleDate: "2026-05-18" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ grossProfitRef: 12 }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ productId: "prod-drill" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "prod-cable" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ customerId: "cont-customer" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ supplierId: "cont-supplier" }]) }));

    const dailySales = renderHook(() => useDailySalesReport(), {
      wrapper: createWrapper(),
    });
    const grossProfit = renderHook(() => useGrossProfitReport(), {
      wrapper: createWrapper(),
    });
    const productProfitability = renderHook(
      () => useProductProfitabilityReport(),
      { wrapper: createWrapper() },
    );
    const lowStock = renderHook(() => useLowStockReport(), {
      wrapper: createWrapper(),
    });
    const customerPurchases = renderHook(() => useCustomerPurchasesReport(), {
      wrapper: createWrapper(),
    });
    const supplierPurchases = renderHook(() => useSupplierPurchasesReport(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(dailySales.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(grossProfit.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(productProfitability.result.current.isSuccess).toBe(true),
    );
    await waitFor(() => expect(lowStock.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(customerPurchases.result.current.isSuccess).toBe(true),
    );
    await waitFor(() =>
      expect(supplierPurchases.result.current.isSuccess).toBe(true),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/daily-sales",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/gross-profit",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/product-profitability",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/low-stock",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/customer-purchases",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/supplier-purchases",
      expect.any(Object),
    );
  });

  it("passes filters to report endpoints that support them", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ productId: "prod-cable" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ productId: "prod-cable" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ customerId: "cont-customer" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "purchase-001" }]) }));

    const stockCard = renderHook(
      () => useStockCardReport({ productId: "prod-cable" }),
      { wrapper: createWrapper() },
    );
    const topProducts = renderHook(
      () => useTopProductsReport({ from: "2026-05-18", to: "2026-05-19" }),
      { wrapper: createWrapper() },
    );
    const topCustomers = renderHook(
      () => useTopCustomersReport({ from: "2026-05-18", to: "2026-05-19" }),
      { wrapper: createWrapper() },
    );
    const purchases = renderHook(
      () =>
        usePurchasesReport({
          from: "2026-05-17",
          supplierId: "cont-supplier",
          to: "2026-05-19",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(stockCard.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(topProducts.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(topCustomers.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(purchases.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/stock-card?productId=prod-cable",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/top-products?from=2026-05-18&to=2026-05-19",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/top-customers?from=2026-05-18&to=2026-05-19",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/purchases?from=2026-05-17&supplierId=cont-supplier&to=2026-05-19",
      expect.any(Object),
    );
  });
});
