/**
 * REP-09a · el flujo de ventas del dashboard se dibuja con `TimeSeriesChart`:
 * picos destacados, periodo anterior atenuado, delta del total en la cabecera
 * ("—" sin datos previos) y ventana mínima de 7 días.
 */
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

import { getDashboardSalesTrend } from "@/modules/dashboard/services/dashboard.mock-server";
import type { TimeSeriesChartProps } from "@/shared/components/TimeSeriesChart";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

const mockChart = jest.fn();

jest.mock("../../../shared/components/TimeSeriesChart", () => ({
  TimeSeriesChart: (props: TimeSeriesChartProps) => {
    mockChart(props);

    return (
      <div data-testid="time-series-chart">
        {props.loading ? "cargando" : (props.error ?? `${props.series.length} series`)}
      </div>
    );
  },
}));

import { DashboardSalesChartCard } from "./DashboardSalesChartCard";

type Bucket = { count: number; totalRef: number };

/** Serie diaria de 7 días con el periodo anterior que se indique. */
function seriesPayload(current: Bucket[], previous: Bucket[] | null) {
  const bucket = (item: Bucket, index: number, firstDay: number) => {
    const key = `2026-05-${String(firstDay + index).padStart(2, "0")}`;

    return {
      ...item,
      from: key,
      key,
      label: `${key.slice(8)}/05`,
      paidVes: item.totalRef * 500,
      to: key,
      totalVes: item.totalRef * 500,
    };
  };
  const total = (items: Bucket[]) => ({
    count: items.reduce((sum, item) => sum + item.count, 0),
    paidVes: items.reduce((sum, item) => sum + item.totalRef * 500, 0),
    totalRef: items.reduce((sum, item) => sum + item.totalRef, 0),
    totalVes: items.reduce((sum, item) => sum + item.totalRef * 500, 0),
  });
  const currentTotal = total(current);
  const previousTotal = previous ? total(previous) : null;

  return {
    items: [],
    series: {
      current: current.map((item, index) => bucket(item, index, 12)),
      groupBy: "day",
      previous: previous?.map((item, index) => bucket(item, index, 5)) ?? null,
      previousRange: previous ? { from: "2026-05-05", to: "2026-05-11" } : null,
      range: { from: "2026-05-12", to: "2026-05-18" },
      totals: {
        current: currentTotal,
        deltaPct:
          previousTotal && previousTotal.totalRef !== 0
            ? ((currentTotal.totalRef - previousTotal.totalRef) / previousTotal.totalRef) * 100
            : null,
        previous: previousTotal,
      },
    },
  };
}

const WEEK: Bucket[] = [10, 40, 15, 60, 20, 35, 20].map((totalRef) => ({ count: 2, totalRef }));
const PREVIOUS_WEEK: Bucket[] = [20, 20, 20, 20, 20, 30, 30].map((totalRef) => ({
  count: 1,
  totalRef,
}));
const EMPTY_WEEK: Bucket[] = Array.from({ length: 7 }, () => ({ count: 0, totalRef: 0 }));

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("DashboardSalesChartCard", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    mockChart.mockClear();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  function renderCard(props: Parameters<typeof DashboardSalesChartCard>[0] = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <DashboardSalesChartCard {...props} />
      </QueryClientProvider>,
    );
  }

  function lastChartProps() {
    return mockChart.mock.calls.at(-1)?.[0] as TimeSeriesChartProps;
  }

  it("dibuja la serie con TimeSeriesChart, sus 3 picos y el periodo anterior alineado", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: seriesPayload(WEEK, PREVIOUS_WEEK) }));
    renderCard({ range: { from: "2026-05-12", to: "2026-05-18" } });

    await waitFor(() => expect(lastChartProps().series).toHaveLength(1));
    const [series] = lastChartProps().series;

    expect(lastChartProps().peakCount).toBe(3);
    expect(lastChartProps().ariaLabel).toBe("Flujo de ventas");
    expect(series.points).toHaveLength(7);
    expect(series.points[3]).toMatchObject({
      count: 2,
      key: "2026-05-15",
      valueRef: 60,
      valueVes: 30000,
    });
    expect(series.previousPoints).toHaveLength(7);
    expect(series.previousPoints?.[0]).toMatchObject({ key: "2026-05-05", valueRef: 20 });
    // 200 frente a 160 del periodo anterior.
    expect(screen.getByTestId("sales-chart-delta")).toHaveTextContent(/^↑ 25 %$/);
    expect(screen.getByText(/12–18 may 2026 · por día$/)).toBeInTheDocument();
    // Una sola petición: actual y anterior llegan en la misma respuesta.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/dashboard/sales-trend?compare=1&from=2026-05-12&to=2026-05-18",
    );
  });

  it("una caída se muestra con flecha hacia abajo, en el mismo formato que Reportes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: seriesPayload(PREVIOUS_WEEK, WEEK) }));
    renderCard({ range: { from: "2026-05-12", to: "2026-05-18" } });

    expect(await screen.findByTestId("sales-chart-delta")).toHaveTextContent(/^↓ 20 %$/);
  });

  it.each([
    ["el periodo anterior suma 0", seriesPayload(WEEK, EMPTY_WEEK)],
    ["no hay periodo anterior", seriesPayload(WEEK, null)],
  ])("muestra — cuando %s, nunca NaN ni Infinity", async (_name, payload) => {
    fetchMock.mockResolvedValue(jsonResponse({ data: payload }));
    renderCard({ range: { from: "2026-05-12", to: "2026-05-18" } });

    const delta = await screen.findByTestId("sales-chart-delta");

    expect(delta).toHaveTextContent(/^—$/);
    expect(document.body).not.toHaveTextContent(/NaN|Infinity/);
    expect(lastChartProps().series).toHaveLength(1);
  });

  // REP-F2: un solo formato de variación en dashboard y Reportes (coma decimal, espacio antes de %).
  it("la variación usa coma decimal y espacio antes de %", async () => {
    const payload = seriesPayload(WEEK, PREVIOUS_WEEK);

    payload.series.totals.deltaPct = 106.67;
    fetchMock.mockResolvedValue(jsonResponse({ data: payload }));
    renderCard({ range: { from: "2026-05-12", to: "2026-05-18" } });

    expect(await screen.findByTestId("sales-chart-delta")).toHaveTextContent(/^↑ 106,7 %$/);
    expect(screen.getByText(/sube 106,7 %/)).toHaveClass("sr-only");
  });

  it("un periodo de menos de 7 días amplía la ventana a los últimos 7 y lo dice", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: seriesPayload(WEEK, PREVIOUS_WEEK) }));
    renderCard({ range: { from: "2026-05-17", to: "2026-05-17" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/dashboard/sales-trend?compare=1&from=2026-05-11&to=2026-05-17",
    );
    expect(
      await screen.findByText(/11–17 may 2026 · por día · últimos 7 días \(el periodo elegido es más corto\)/),
    ).toBeInTheDocument();
  });

  it("sin periodo usa los últimos 7 días que terminan hoy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: seriesPayload(WEEK, PREVIOUS_WEEK) }));
    renderCard();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^\/api\/dashboard\/sales-trend\?compare=1&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("un rango largo indica la agrupación efectiva que eligió el servidor", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: getDashboardSalesTrend(
          new URLSearchParams("from=2025-01-01&to=2026-05-18&compare=1"),
          DEFAULT_STORE_ID,
        ),
      }),
    );
    renderCard({ range: { from: "2025-01-01", to: "2026-05-18" } });

    expect(await screen.findByText(/· por mes$/)).toBeInTheDocument();
    expect(lastChartProps().series[0].points.length).toBeGreaterThan(12);
  });

  it("en el dashboard de plataforma pide la serie con el alcance de tiendas", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: seriesPayload(WEEK, PREVIOUS_WEEK) }));
    renderCard({
      range: { from: "2026-05-12", to: "2026-05-18" },
      scope: { pathPrefix: "/api/platform/home", storeIds: "a,b", storeScope: "selected" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/platform/home/sales-trend?compare=1&from=2026-05-12&to=2026-05-18&storeIds=a%2Cb&storeScope=selected",
    );
  });

  it("delega los estados cargando, vacío y error en TimeSeriesChart", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (resolveFetch = resolve)));
    renderCard({ range: { from: "2026-05-12", to: "2026-05-18" } });

    expect(lastChartProps().loading).toBe(true);
    expect(screen.queryByTestId("sales-chart-delta")).not.toBeInTheDocument();

    // Vacío: ni ventas en el periodo ni en el anterior → sin series.
    resolveFetch(jsonResponse({ data: seriesPayload(EMPTY_WEEK, EMPTY_WEEK) }));
    await waitFor(() => expect(lastChartProps().loading).toBe(false));
    expect(lastChartProps().series).toEqual([]);
    expect(lastChartProps().emptyTitle).toBe("Sin ventas en este periodo");
  });

  it("si la consulta falla el gráfico muestra el error con reintento", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "No disponible." } }, 500),
    );
    renderCard({ range: { from: "2026-05-12", to: "2026-05-18" } });

    await waitFor(() =>
      expect(lastChartProps().error).toBe("No pudimos cargar el flujo de ventas."),
    );
    expect(lastChartProps().onRetry).toEqual(expect.any(Function));
  });

  it("no queda ningún color literal ni gráfico de barras propio", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/dashboard/components/DashboardSalesChartCard.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|text-red-|recharts|BarChart/);
  });
});
