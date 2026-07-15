import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useDashboardLowStock,
  useDashboardMetrics,
  useDashboardRecentSales,
  useDashboardSummary,
} from "./useDashboard";

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

describe("dashboard hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads the dashboard summary", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          activeCustomers: 4,
          dayOverDayChangePercent: 12.5,
          lowStockCount: 2,
          pendingSalesCount: 1,
          previousDayTotalRef: 35,
          salesCount: 3,
          totalRef: 40,
          totalVes: 20400,
        },
      }),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.salesCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/summary",
      expect.any(Object),
    );
  });

  it("loads dashboard metrics with date filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          from: "2026-05-18",
          paidVes: 1000,
          pendingVes: 500,
          salesCount: 1,
          to: "2026-05-18",
          totalRef: 3,
          totalVes: 1500,
          unitsSold: 2,
        },
      }),
    );

    const { result } = renderHook(
      () => useDashboardMetrics({ from: "2026-05-18", to: "2026-05-18" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/metrics?from=2026-05-18&to=2026-05-18",
      expect.any(Object),
    );
  });

  it("loads recent sales and low stock products", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "sale-001" }]) }))
      .mockResolvedValueOnce(jsonResponse({ data: paginated([{ id: "prod-cable" }]) }));

    const recentSales = renderHook(() => useDashboardRecentSales(), {
      wrapper: createWrapper(),
    });
    const lowStock = renderHook(() => useDashboardLowStock(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(recentSales.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(lowStock.result.current.isSuccess).toBe(true));

    expect(recentSales.result.current.data?.items).toEqual([{ id: "sale-001" }]);
    expect(lowStock.result.current.data?.items).toEqual([{ id: "prod-cable" }]);
  });
});
