import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  inventoryReportsQueryKeys,
  useDeadStockReport,
  useStockAdjustmentsReport,
  useStockTurnoverReport,
} from "./useInventoryReports";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

describe("hooks de reportes de inventario", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  /** URL de la única petición hecha, con sus parámetros. */
  function requestedUrl() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");

    return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
  }

  it("useDeadStockReport sin filtros no manda parámetros (los 30 días los pone el servidor)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { asOf: "2026-05-18", days: 30, items: [], limit: 10, skip: 0, summary: { productsCount: 0 }, total: 0 },
      }),
    );

    const { result } = renderHook(() => useDeadStockReport(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({ path: "/api/reports/dead-stock", query: {} });
    expect(result.current.data?.days).toBe(30);
  });

  it("useDeadStockReport manda días, categoría y paginación", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { items: [], limit: 20, skip: 40, summary: { productsCount: 7 }, total: 7 } }),
    );

    const { result } = renderHook(() => useDeadStockReport({ categoryId: "cat-1", days: 60, limit: 20, skip: 40 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/dead-stock",
      query: { categoryId: "cat-1", days: "60", limit: "20", skip: "40" },
    });
    expect(result.current.data?.summary.productsCount).toBe(7);
  });

  it("useStockTurnoverReport manda rango, agrupación y paginación", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { groupBy: "category", items: [], totals: { turnover: 1.5 } } }));

    const { result } = renderHook(
      () => useStockTurnoverReport({ from: "2026-05-01", groupBy: "category", limit: 50, skip: 0, to: "2026-05-31" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/stock-turnover",
      query: { from: "2026-05-01", groupBy: "category", limit: "50", skip: "0", to: "2026-05-31" },
    });
    expect(result.current.data?.totals.turnover).toBe(1.5);
  });

  it("useStockAdjustmentsReport manda rango y agrupación", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { byReason: [{ reason: "Merma" }], costBasis: "current_cost", items: [] } }),
    );

    const { result } = renderHook(
      () => useStockAdjustmentsReport({ from: "2026-05-01", groupBy: "week", to: "2026-05-31" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/stock-adjustments",
      query: { from: "2026-05-01", groupBy: "week", to: "2026-05-31" },
    });
    expect(result.current.data?.byReason[0]?.reason).toBe("Merma");
    expect(result.current.data?.costBasis).toBe("current_cost");
  });

  it.each([
    ["sin fechas", {}],
    ["sin hasta", { from: "2026-05-01" }],
    ["sin desde", { to: "2026-05-31" }],
    ["desactivado", { from: "2026-05-01", to: "2026-05-31" }],
  ])("los reportes de rango no consultan %s", (label, range) => {
    const options = { enabled: label !== "desactivado" };
    const turnover = renderHook(() => useStockTurnoverReport(range, options), { wrapper: createWrapper() });
    const adjustments = renderHook(() => useStockAdjustmentsReport(range, options), { wrapper: createWrapper() });

    expect(turnover.result.current.fetchStatus).toBe("idle");
    expect(adjustments.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("useDeadStockReport desactivado no consulta", () => {
    const { result } = renderHook(() => useDeadStockReport({}, { enabled: false }), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un 403 del reporte llega como error del hook", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso para realizar esta accion." } }, 403),
    );

    const { result } = renderHook(() => useDeadStockReport(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toMatch(/No tienes permiso/);
  });

  it("un 400 de parámetros llega con su mensaje en español", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "BAD_REQUEST", message: "La agrupación no es válida. Usa product o category." } },
        400,
      ),
    );

    const { result } = renderHook(() => useStockTurnoverReport({ from: "2026-05-01", to: "2026-05-31" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toMatch(/La agrupación no es válida/);
  });

  it("las claves de caché separan reporte y filtros bajo una raíz común", () => {
    const deadStock = inventoryReportsQueryKeys.deadStock({ days: 30 });
    const turnover = inventoryReportsQueryKeys.stockTurnover({ from: "2026-05-01", to: "2026-05-31" });
    const adjustments = inventoryReportsQueryKeys.stockAdjustments({ from: "2026-05-01", to: "2026-05-31" });

    for (const key of [deadStock, turnover, adjustments]) {
      expect(key.slice(0, 2)).toEqual([...inventoryReportsQueryKeys.all]);
    }
    expect(new Set([deadStock[2], turnover[2], adjustments[2]]).size).toBe(3);
    expect(inventoryReportsQueryKeys.deadStock({ days: 60 })).not.toEqual(deadStock);
  });
});
