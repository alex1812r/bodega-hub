/**
 * REP-F3 · `/platform/dashboard` recupera los periodos que perdió al pasar a
 * `DateRangeField` ("Últimos 14 días", "Últimos 3 meses", "Últimos 6 meses" y
 * "Desde el inicio") y guarda su periodo en la URL (`preset` / `from` + `to`),
 * igual que el dashboard de tienda.
 */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as dashboardMock from "@/modules/dashboard/services/dashboard.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

const TODAY = "2026-05-18";
const EXTRA_CHIPS = ["Últimos 14 días", "Últimos 3 meses", "Últimos 6 meses", "Desde el inicio"];
const STORE_CHIPS = [
  "Hoy",
  "Ayer",
  "Esta semana",
  "Semana pasada",
  "Este mes",
  "Mes pasado",
  "Últimos 30 días",
  "Personalizado",
];

jest.mock("next/navigation", () => ({
  usePathname: () => "/platform/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../dashboard/utils/businessDate", () => ({
  ...jest.requireActual("../../dashboard/utils/businessDate"),
  getBusinessTodayIsoDate: () => "2026-05-18",
}));
jest.mock("../../../shared/components/TimeSeriesChart", () => ({
  TimeSeriesChart: () => <div data-testid="time-series-chart" />,
}));

import { PlatformDashboardPage } from "./page";

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => ({ data: payload }),
    ok: true,
    status: 200,
  } as unknown as Response;
}

function respond(url: URL) {
  const params = url.searchParams;

  switch (url.pathname) {
    case "/api/platform/home/summary":
      return dashboardMock.getDashboardSummary(DEFAULT_STORE_ID);
    case "/api/platform/home/metrics":
      return dashboardMock.getDashboardMetrics(params, DEFAULT_STORE_ID);
    case "/api/platform/home/sales-trend":
      return dashboardMock.getDashboardSalesTrend(params, DEFAULT_STORE_ID);
    case "/api/platform/home/recent-sales":
      return dashboardMock.getRecentSales(params, DEFAULT_STORE_ID);
    case "/api/platform/home/low-stock":
      return dashboardMock.getDashboardLowStock(params, DEFAULT_STORE_ID);
    case "/api/platform/stores":
      return { items: [], limit: 100, skip: 0, total: 0 };
    default:
      throw new Error(`Endpoint inesperado en el dashboard de plataforma: ${url.pathname}`);
  }
}

describe("/platform/dashboard · periodos extendidos y periodo en la URL (REP-F3)", () => {
  const requests: { path: string; query: URLSearchParams }[] = [];

  beforeEach(() => {
    requests.length = 0;
    window.history.replaceState(null, "", "/platform/dashboard");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");

      requests.push({ path: url.pathname, query: url.searchParams });

      return jsonResponse(respond(url));
    }) as unknown as typeof fetch;
  });

  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <PlatformDashboardPage />
      </QueryClientProvider>,
    );
  }

  /** `from` / `to` / `fromStart` / `compare` de cada petición a ese endpoint. */
  function periodsOf(slug: string) {
    return requests
      .filter((request) => request.path === `/api/platform/home/${slug}`)
      .map(({ query }) =>
        Object.fromEntries(
          ["compare", "from", "fromStart", "to"].flatMap((name) => {
            const value = query.get(name);

            return value === null ? [] : [[name, value]];
          }),
        ),
      );
  }

  async function waitForPage() {
    await screen.findByTestId("time-series-chart");
    await waitFor(() => expect(periodsOf("metrics")).not.toHaveLength(0));
    await waitFor(() => expect(periodsOf("sales-trend")).not.toHaveLength(0));
  }

  function periodGroup() {
    return screen.getByRole("group", { name: "Periodo" });
  }

  it("muestra los chips de tienda y, después, los cuatro de plataforma", async () => {
    renderPage();
    await waitForPage();

    const chips = within(periodGroup())
      .getAllByRole("button")
      .map((chip) => chip.textContent);

    expect(chips).toEqual([...STORE_CHIPS.slice(0, 7), ...EXTRA_CHIPS, "Personalizado"]);
  });

  it("por defecto el periodo es hoy, sin nada en la URL, y conserva el alcance de tiendas", async () => {
    renderPage();
    await waitForPage();

    expect(window.location.search).toBe("");
    expect(within(periodGroup()).getByRole("button", { name: "Hoy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(periodsOf("metrics")).toEqual(
      expect.arrayContaining([
        { from: TODAY, to: TODAY },
        { from: "2026-05-17", to: "2026-05-17" },
      ]),
    );
    expect(screen.getByText("Alcance de tiendas")).toBeInTheDocument();
    expect(requests.find((request) => request.path.endsWith("/metrics"))?.query.get("storeScope")).toBe(
      "all",
    );
  });

  it("«Desde el inicio» pide las métricas con fromStart y sin periodo anterior", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForPage();
    requests.length = 0;

    await user.click(within(periodGroup()).getByRole("button", { name: "Desde el inicio" }));

    await waitFor(() => expect(window.location.search).toBe("?preset=all_time"));
    await waitFor(() => expect(periodsOf("metrics")).toEqual([{ fromStart: "1", to: TODAY }]));
    // El gráfico también va desde el inicio, sin comparación.
    await waitFor(() => expect(periodsOf("sales-trend")).toEqual([{ fromStart: "1", to: TODAY }]));
    expect(within(periodGroup()).getByRole("button", { name: "Desde el inicio" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(periodGroup()).getByTestId("date-range-label")).toHaveTextContent("Desde el inicio");
    expect(screen.getByText("Ventas desde el inicio")).toBeInTheDocument();
    // El gráfico dice qué tramo dibuja (del primer día con ventas a hoy) y cómo lo agrupa.
    expect(
      await screen.findByText(/^Desde el inicio · .+ 2026 · por (día|semana|mes)$/),
    ).toBeInTheDocument();
    expect(await screen.findByText("Sin periodo anterior comparable")).toBeInTheDocument();
  });

  it("?preset=last_3_months al montar: los últimos 90 días", async () => {
    window.history.replaceState(null, "", "/platform/dashboard?preset=last_3_months");
    renderPage();
    await waitForPage();

    expect(within(periodGroup()).getByRole("button", { name: "Últimos 3 meses" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(periodsOf("metrics")).toEqual(
      expect.arrayContaining([
        { from: "2026-02-18", to: TODAY },
        { from: "2025-11-20", to: "2026-02-17" },
      ]),
    );
    expect(periodsOf("sales-trend")).toEqual([{ compare: "1", from: "2026-02-18", to: TODAY }]);
    expect(window.location.search).toBe("?preset=last_3_months");
  });

  it("?preset=all_time al montar", async () => {
    window.history.replaceState(null, "", "/platform/dashboard?preset=all_time");
    renderPage();
    await waitForPage();

    expect(periodsOf("metrics")).toEqual([{ fromStart: "1", to: TODAY }]);
    expect(window.location.search).toBe("?preset=all_time");
  });

  it("?from&to en la URL es un rango personalizado", async () => {
    window.history.replaceState(null, "", "/platform/dashboard?from=2026-05-04&to=2026-05-15");
    renderPage();
    await waitForPage();

    expect(within(periodGroup()).getByRole("button", { name: /Personalizado/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(periodsOf("sales-trend")).toEqual([
      { compare: "1", from: "2026-05-04", to: "2026-05-15" },
    ]);
  });

  it("elegir un periodo lo escribe en la URL con replaceState; Hoy la deja limpia", async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(window.history, "pushState");
    renderPage();
    await waitForPage();

    await user.click(within(periodGroup()).getByRole("button", { name: "Últimos 14 días" }));
    await waitFor(() => expect(window.location.search).toBe("?preset=last_14_days"));
    await waitFor(() =>
      expect(periodsOf("metrics")).toEqual(
        expect.arrayContaining([{ from: "2026-05-05", to: TODAY }]),
      ),
    );

    await user.click(within(periodGroup()).getByRole("button", { name: "Últimos 6 meses" }));
    await waitFor(() => expect(window.location.search).toBe("?preset=last_6_months"));
    await waitFor(() =>
      expect(periodsOf("metrics")).toEqual(
        expect.arrayContaining([{ from: "2025-11-20", to: TODAY }]),
      ),
    );

    await user.click(within(periodGroup()).getByRole("button", { name: "Hoy" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });
});
