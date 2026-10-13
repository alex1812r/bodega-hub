import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  moneyReportsQueryKeys,
  useCashCloseDifferencesReport,
  usePayablesAgingReport,
  useReceivablesAgingReport,
  useSalesByCategoryReport,
  useSalesByHourReport,
} from "./useMoneyReports";

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

describe("hooks de reportes de dinero", () => {
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

  it("useSalesByHourReport pide la matriz del rango", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { matrix: [], totals: { salesCount: 3 } } }));

    const { result } = renderHook(() => useSalesByHourReport({ from: "2026-05-01", to: "2026-05-31" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/sales-by-hour",
      query: { from: "2026-05-01", to: "2026-05-31" },
    });
    expect(result.current.data?.totals.salesCount).toBe(3);
  });

  it("useSalesByCategoryReport pide las categorías del rango", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { items: [{ categoryName: "Bebidas" }] } }));

    const { result } = renderHook(() => useSalesByCategoryReport({ from: "2026-05-01", to: "2026-05-31" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/sales-by-category",
      query: { from: "2026-05-01", to: "2026-05-31" },
    });
    expect(result.current.data?.items[0]?.categoryName).toBe("Bebidas");
  });

  it.each([
    ["sin fechas", {}],
    ["sin hasta", { from: "2026-05-01" }],
    ["desactivado", { from: "2026-05-01", to: "2026-05-31" }],
  ])("los reportes de rango no consultan %s", async (label, range) => {
    const options = { enabled: label !== "desactivado" };
    const hour = renderHook(() => useSalesByHourReport(range, options), { wrapper: createWrapper() });
    const category = renderHook(() => useSalesByCategoryReport(range, options), { wrapper: createWrapper() });

    expect(hour.result.current.fetchStatus).toBe("idle");
    expect(category.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("useReceivablesAgingReport manda tramo, contacto y paginación", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { items: [], limit: 20, skip: 40, total: 0 } }));

    const { result } = renderHook(
      () => useReceivablesAgingReport({ bucket: "30+", contactId: "cont-1", limit: 20, skip: 40 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/receivables-aging",
      query: { bucket: "30+", contactId: "cont-1", limit: "20", skip: "40" },
    });
  });

  it("usePayablesAgingReport sin filtros no manda parámetros", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } }));

    const { result } = renderHook(() => usePayablesAgingReport(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({ path: "/api/reports/payables-aging", query: {} });
  });

  it("useCashCloseDifferencesReport manda rango, moneda y paginación", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0, totals: [] } }));

    const { result } = renderHook(
      () => useCashCloseDifferencesReport({ currency: "ves", from: "2026-05-01", limit: 10, to: "2026-05-31" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl()).toEqual({
      path: "/api/reports/cash-close-differences",
      query: { currency: "ves", from: "2026-05-01", limit: "10", to: "2026-05-31" },
    });
  });

  it("un 403 del reporte llega como error del hook", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso para realizar esta acción." } }, 403),
    );

    const { result } = renderHook(() => useCashCloseDifferencesReport(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toMatch(/No tienes permiso/);
  });

  it("los desactivados no consultan", () => {
    renderHook(() => useReceivablesAgingReport({}, { enabled: false }), { wrapper: createWrapper() });
    renderHook(() => usePayablesAgingReport({}, { enabled: false }), { wrapper: createWrapper() });
    renderHook(() => useCashCloseDifferencesReport({}, { enabled: false }), { wrapper: createWrapper() });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cada reporte y cada filtro tienen su clave de caché bajo la raíz común", () => {
    const keys = [
      moneyReportsQueryKeys.salesByHour({ from: "2026-05-01", to: "2026-05-31" }),
      moneyReportsQueryKeys.salesByCategory({ from: "2026-05-01", to: "2026-05-31" }),
      moneyReportsQueryKeys.receivablesAging({ bucket: "30+" }),
      moneyReportsQueryKeys.receivablesAging({ bucket: "0-7" }),
      moneyReportsQueryKeys.payablesAging({ bucket: "30+" }),
      moneyReportsQueryKeys.cashCloseDifferences({ currency: "ves" }),
    ];

    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
    expect(keys.every((key) => key[0] === moneyReportsQueryKeys.all[0] && key[1] === moneyReportsQueryKeys.all[1])).toBe(true);
  });
});
