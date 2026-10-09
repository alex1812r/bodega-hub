import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  reportsQueryKeys,
  useCustomerPurchasesReport,
  useDailySalesReport,
  useGrossProfitReport,
  useLowStockReport,
  usePaymentMethodsReport,
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
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "purchase-001" }]) }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            items: [{ method: "efectivo_ves", paymentCount: 1, amountRef: 10, amountVes: 5000 }],
            limit: 10,
            skip: 0,
            summary: { paymentCount: 1, totalRef: 10, totalVes: 5000 },
            total: 5,
          },
        }),
      );

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
    const paymentMethods = renderHook(
      () => usePaymentMethodsReport({ from: "2026-05-18", to: "2026-05-18" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(stockCard.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(topProducts.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(topCustomers.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(purchases.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(paymentMethods.result.current.isSuccess).toBe(true));

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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/payment-methods?from=2026-05-18&to=2026-05-18",
      expect.any(Object),
    );
  });
});

describe("report hooks: groupBy y compare (REP-05)", () => {
  const fetchMock = jest.fn();

  function requestedUrls() {
    return fetchMock.mock.calls.map(([url]) => new URL(String(url), "http://localhost"));
  }

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse({ data: paginated([]) }));
    global.fetch = fetchMock;
  });

  it("envía from, to, groupBy y compare=1 en los reportes de serie", async () => {
    const filters = { compare: true, from: "2026-05-01", groupBy: "week", to: "2026-05-31" } as const;
    const wrapper = createWrapper();
    const hooks = [
      renderHook(() => useDailySalesReport(filters), { wrapper }),
      renderHook(() => useGrossProfitReport(filters), { wrapper }),
      renderHook(() => usePurchasesReport({ ...filters, supplierId: "cont-supplier" }), { wrapper }),
      renderHook(() => usePaymentMethodsReport({ compare: true, from: "2026-05-01", to: "2026-05-31" }), {
        wrapper,
      }),
    ];

    for (const hook of hooks) {
      await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    }

    const byPath = new Map(requestedUrls().map((url) => [url.pathname, url.searchParams]));

    for (const path of ["daily-sales", "gross-profit", "purchases"]) {
      const params = byPath.get(`/api/reports/${path}`);

      expect(params?.get("from")).toBe("2026-05-01");
      expect(params?.get("to")).toBe("2026-05-31");
      expect(params?.get("groupBy")).toBe("week");
      expect(params?.get("compare")).toBe("1");
    }

    expect(byPath.get("/api/reports/purchases")?.get("supplierId")).toBe("cont-supplier");
    expect(byPath.get("/api/reports/payment-methods")?.get("compare")).toBe("1");
    expect(byPath.get("/api/reports/payment-methods")?.has("groupBy")).toBe(false);
  });

  it("sin compare no manda el parámetro y con fromStart no manda from", async () => {
    const wrapper = createWrapper();
    const hook = renderHook(
      () => useDailySalesReport({ compare: false, from: "2026-05-01", fromStart: true, groupBy: "auto" }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    const params = requestedUrls()[0]!.searchParams;

    expect(params.has("compare")).toBe(false);
    expect(params.has("from")).toBe(false);
    expect(params.get("fromStart")).toBe("1");
    expect(params.get("groupBy")).toBe("auto");
  });

  it("la query key cambia con groupBy y con compare: cada combinación tiene su entrada de caché", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const range = { from: "2026-05-01", to: "2026-05-31" };
    const variants = [
      { ...range, groupBy: "day" },
      { ...range, groupBy: "week" },
      { ...range, compare: true, groupBy: "week" },
      { ...range, groupBy: "week" },
    ] as const;

    for (const filters of variants) {
      const hook = renderHook(() => useDailySalesReport(filters), { wrapper });
      await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    }

    // La cuarta variante repite la segunda: comparte entrada.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(3);
  });

  it("cada reporte tiene su propia query key aunque compartan filtros y página", () => {
    const filters = { limit: 10, skip: 20 };
    const keys = [
      [...reportsQueryKeys.dailySales(), filters],
      [...reportsQueryKeys.grossProfit(), filters],
      [...reportsQueryKeys.productProfitability(), filters],
      [...reportsQueryKeys.lowStock(), filters],
      [...reportsQueryKeys.customerPurchases(), filters],
      [...reportsQueryKeys.supplierPurchases(), filters],
      reportsQueryKeys.purchases(filters),
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(keys.length);
  });
});
