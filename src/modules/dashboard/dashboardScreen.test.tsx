/**
 * REP-09a · pantalla `/dashboard` con sus hooks reales:
 *
 * - un solo `DateRangeField` gobierna indicadores, mix de pagos, cierre y
 *   gráfico, y su rango vive en la URL (`from` / `to` / `preset`);
 * - ningún rol dispara una petición que el servidor le contestaría con 403
 *   (bug heredado: almacén pedía `/api/reports/payment-methods`). El permiso de
 *   cada endpoint se lee del código de su `route.ts`, no de una lista del test.
 */
import "@testing-library/jest-dom";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as dashboardMock from "@/modules/dashboard/services/dashboard.mock-server";
import { rolePermissions, type UserRole } from "@/shared/auth/permissions";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

const TODAY = "2026-05-18";

let mockRole: UserRole = "admin";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) =>
      (jest.requireActual("../../shared/auth/permissions").rolePermissions[mockRole] as string[]).includes(
        permission,
      ),
    isLoading: false,
    role: mockRole,
  }),
}));
jest.mock("./utils/businessDate", () => ({
  ...jest.requireActual("./utils/businessDate"),
  getBusinessTodayIsoDate: () => "2026-05-18",
}));
jest.mock("../../shared/components/TimeSeriesChart", () => ({
  TimeSeriesChart: () => <div data-testid="time-series-chart" />,
}));
jest.mock("../reports/reports-list/components/DailyClosePanel", () => ({
  DailyClosePanel: ({ periodLabel }: { periodLabel?: string }) => (
    <div data-testid="daily-close">Cierre: {periodLabel}</div>
  ),
}));

import DashboardPage from "@/app/dashboard/page";

const SRC = join(process.cwd(), "src");

/** Permiso que exige la ruta de un endpoint, leído de su `route.ts`. */
function requiredPermission(pathname: string) {
  const routeFile = join(SRC, "app", ...pathname.split("/").filter(Boolean), "route.ts");
  const source = readFileSync(routeFile, "utf8");

  return /require(?:Store)?Permission\(\s*request,\s*"([^"]+)"/.exec(source)?.[1] ?? null;
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function respond(url: URL) {
  const params = url.searchParams;

  switch (url.pathname) {
    case "/api/dashboard/summary":
      return dashboardMock.getDashboardSummary(DEFAULT_STORE_ID);
    case "/api/dashboard/metrics":
      return dashboardMock.getDashboardMetrics(params, DEFAULT_STORE_ID);
    case "/api/dashboard/sales-trend":
      return dashboardMock.getDashboardSalesTrend(params, DEFAULT_STORE_ID);
    case "/api/dashboard/recent-sales":
      return dashboardMock.getRecentSales(params, DEFAULT_STORE_ID);
    case "/api/dashboard/low-stock":
      return dashboardMock.getDashboardLowStock(params, DEFAULT_STORE_ID);
    case "/api/dashboard/daily-close":
      return {};
    case "/api/reports/payment-methods":
      return { items: [], summary: { paymentCount: 0, totalRef: 0, totalVes: 0 } };
    case "/api/products/price-review/summary":
      return { total: 2 };
    default:
      throw new Error(`Endpoint inesperado en el dashboard: ${url.pathname}`);
  }
}

describe("/dashboard · periodo único en la URL y peticiones por rol", () => {
  /** Peticiones hechas, con el permiso que exige su ruta. */
  const requests: { forbidden: boolean; path: string; query: string }[] = [];

  beforeEach(() => {
    mockRole = "admin";
    requests.length = 0;
    window.history.replaceState(null, "", "/dashboard");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const permission = requiredPermission(url.pathname);
      const forbidden =
        permission !== null && !(rolePermissions[mockRole] as readonly string[]).includes(permission);

      requests.push({ forbidden, path: url.pathname, query: url.search });

      return forbidden
        ? jsonResponse({ error: { code: "FORBIDDEN", message: "Sin permiso." } }, 403)
        : jsonResponse({ data: respond(url) });
    }) as unknown as typeof fetch;
  });

  function renderDashboard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>,
    );
  }

  function requestsTo(path: string) {
    return requests.filter((request) => request.path === path).map((request) => request.query);
  }

  /** Espera a que el dashboard haya pedido todo lo que pide al montar. */
  async function waitForDashboard() {
    await screen.findByTestId("daily-close");
    await waitFor(() => expect(requestsTo("/api/dashboard/sales-trend")).not.toHaveLength(0));
    await waitFor(() => expect(requestsTo("/api/dashboard/low-stock")).not.toHaveLength(0));
    await waitFor(() => expect(requestsTo("/api/dashboard/recent-sales")).not.toHaveLength(0));
  }

  const DASHBOARD_ENDPOINTS = [
    "/api/dashboard/daily-close",
    "/api/dashboard/low-stock",
    "/api/dashboard/metrics",
    "/api/dashboard/recent-sales",
    "/api/dashboard/sales-trend",
    "/api/dashboard/summary",
  ];

  it.each([
    ["admin", [...DASHBOARD_ENDPOINTS, "/api/products/price-review/summary", "/api/reports/payment-methods"]],
    ["contador", [...DASHBOARD_ENDPOINTS, "/api/reports/payment-methods"]],
    ["almacen", [...DASHBOARD_ENDPOINTS, "/api/products/price-review/summary"]],
    ["vendedor", [...DASHBOARD_ENDPOINTS, "/api/products/price-review/summary"]],
  ] as const)("%s solo pide lo que su rol puede ver: ningún 403", async (role, expected) => {
    mockRole = role;
    renderDashboard();
    await waitForDashboard();
    await waitFor(() =>
      expect([...new Set(requests.map((request) => request.path))].sort()).toEqual([...expected].sort()),
    );

    expect(requests.filter((request) => request.forbidden)).toEqual([]);
  });

  it("almacén no llama a payment-methods y la tarjeta no deja hueco", async () => {
    mockRole = "almacen";
    renderDashboard();
    await waitForDashboard();

    expect(requestsTo("/api/reports/payment-methods")).toEqual([]);
    expect(screen.queryByText("Mix de pagos")).not.toBeInTheDocument();
    // La rejilla de KPI va seguida del cierre: no queda un contenedor vacío en medio.
    expect(screen.getByTestId("daily-close").previousElementSibling).toHaveClass("grid");
    expect(requiredPermission("/api/reports/payment-methods")).toBe("reports.view");
  });

  it("por defecto el periodo es hoy: no se escribe en la URL y el gráfico usa 7 días", async () => {
    renderDashboard();
    await waitForDashboard();

    expect(window.location.search).toBe("");
    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
    expect(requestsTo("/api/dashboard/metrics").sort()).toEqual([
      "?from=2026-05-17&to=2026-05-17",
      `?from=${TODAY}&to=${TODAY}`,
    ]);
    expect(requestsTo("/api/reports/payment-methods")).toEqual([`?from=${TODAY}&to=${TODAY}`]);
    expect(requestsTo("/api/dashboard/daily-close")).toEqual([`?from=${TODAY}&to=${TODAY}`]);
    // Actual y anterior en una sola petición, con la ventana mínima de 7 días.
    expect(requestsTo("/api/dashboard/sales-trend")).toEqual([
      `?compare=1&from=2026-05-12&to=${TODAY}`,
    ]);
    expect(screen.getByText(/últimos 7 días \(el periodo elegido es más corto\)/)).toBeInTheDocument();
  });

  it("?preset=last_month al montar: todo el dashboard usa el mes pasado", async () => {
    window.history.replaceState(null, "", "/dashboard?preset=last_month");
    renderDashboard();
    await waitForDashboard();

    expect(screen.getByRole("button", { name: "Mes pasado" })).toHaveAttribute("aria-pressed", "true");
    expect(requestsTo("/api/dashboard/metrics").sort()).toEqual([
      // Periodo anterior: los 30 días justo antes.
      "?from=2026-03-02&to=2026-03-31",
      "?from=2026-04-01&to=2026-04-30",
    ]);
    expect(requestsTo("/api/reports/payment-methods")).toEqual(["?from=2026-04-01&to=2026-04-30"]);
    expect(requestsTo("/api/dashboard/daily-close")).toEqual(["?from=2026-04-01&to=2026-04-30"]);
    expect(requestsTo("/api/dashboard/sales-trend")).toEqual([
      "?compare=1&from=2026-04-01&to=2026-04-30",
    ]);
    expect(screen.getByTestId("daily-close")).toHaveTextContent("Cierre: Mes pasado");
    expect(window.location.search).toBe("?preset=last_month");
  });

  it("?from&to en la URL es un rango personalizado", async () => {
    window.history.replaceState(null, "", "/dashboard?from=2026-05-04&to=2026-05-15");
    renderDashboard();
    await waitForDashboard();

    expect(screen.getByRole("button", { name: /Personalizado/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(requestsTo("/api/dashboard/sales-trend")).toEqual([
      "?compare=1&from=2026-05-04&to=2026-05-15",
    ]);
    expect(screen.getByTestId("daily-close")).toHaveTextContent("Cierre: 4–15 may 2026");
  });

  it("elegir un periodo lo escribe en la URL y vuelve a pedir; Hoy la deja limpia", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await waitForDashboard();

    const period = screen.getByRole("group", { name: "Periodo" });

    await user.click(within(period).getByRole("button", { name: "Últimos 30 días" }));
    await waitFor(() => expect(window.location.search).toBe("?preset=last_30_days"));
    await waitFor(() =>
      expect(requestsTo("/api/dashboard/sales-trend")).toContain(
        `?compare=1&from=2026-04-19&to=${TODAY}`,
      ),
    );
    expect(requestsTo("/api/dashboard/metrics")).toEqual(
      expect.arrayContaining([`?from=2026-04-19&to=${TODAY}`, "?from=2026-03-20&to=2026-04-18"]),
    );

    await user.click(within(period).getByRole("button", { name: "Hoy" }));
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  describe("REP-F3 · el dashboard de tienda no cambia", () => {
    it("muestra exactamente los ocho chips de siempre, sin los de plataforma", async () => {
      renderDashboard();
      await waitForDashboard();

      const period = screen.getByRole("group", { name: "Periodo" });

      expect(within(period).getAllByRole("button").map((chip) => chip.textContent)).toEqual([
        "Hoy",
        "Ayer",
        "Esta semana",
        "Semana pasada",
        "Este mes",
        "Mes pasado",
        "Últimos 30 días",
        "Personalizado",
      ]);

      for (const name of ["Últimos 14 días", "Últimos 3 meses", "Últimos 6 meses", "Desde el inicio"]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
    });

    it.each(["all_time", "last_14_days", "last_3_months", "last_6_months"])(
      "?preset=%s no es un periodo de tienda: el periodo es hoy y nada se pide con fromStart",
      async (preset) => {
        window.history.replaceState(null, "", `/dashboard?preset=${preset}`);
        renderDashboard();
        await waitForDashboard();

        expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
        expect(requestsTo("/api/dashboard/metrics").sort()).toEqual([
          "?from=2026-05-17&to=2026-05-17",
          `?from=${TODAY}&to=${TODAY}`,
        ]);
        expect(requestsTo("/api/dashboard/sales-trend")).toEqual([
          `?compare=1&from=2026-05-12&to=${TODAY}`,
        ]);
        expect(requests.filter((request) => request.query.includes("fromStart"))).toEqual([]);
      },
    );
  });

  describe("limpieza del módulo", () => {
    function sourceFiles(directory: string): string[] {
      return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);

        if (statSync(path).isDirectory()) {
          return sourceFiles(path);
        }

        return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
      });
    }

    const sources = [
      ...sourceFiles(join(SRC, "modules/dashboard")),
      ...sourceFiles(join(SRC, "app/dashboard")),
      join(SRC, "modules/platform/dashboard/page.tsx"),
    ].map((path) => ({ path, text: readFileSync(path, "utf8") }));

    it("DashboardPeriodFilterModal y los periodos fijos del gráfico ya no existen", () => {
      for (const file of ["components/DashboardPeriodFilterModal.tsx", "utils/chartPeriod.ts", "utils/chartSeries.ts", "utils/demoChartSeries.ts"]) {
        expect(existsSync(join(SRC, "modules/dashboard", file))).toBe(false);
      }

      const mentions = sources.filter(({ text }) =>
        /DashboardPeriodFilterModal|chartPeriod|demoChartSeries/.test(text),
      );

      expect(mentions.map(({ path }) => path)).toEqual([]);
    });

    it("no hay inputs nativos de fecha ni diálogos del navegador en el dashboard", () => {
      const offenders = sources.filter(({ text }) =>
        /type="(date|datetime-local|month|number)"|window\.(confirm|alert|prompt)/.test(text),
      );

      expect(offenders.map(({ path }) => path)).toEqual([]);
    });
  });
});
