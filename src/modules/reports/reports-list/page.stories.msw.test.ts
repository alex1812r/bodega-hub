/**
 * @jest-environment node
 *
 * REP-F2 · las stories de `/reports` salían sin gráfico: Storybook fija el reloj
 * en 2024 y los datos de prueba son de mayo de 2026, así que «últimos 30 días»
 * no traía nada; y `GET /api/reports/payment-methods` no tenía handler (404).
 * Aquí se pide a los handlers de Storybook lo mismo que pide cada story.
 */
import { getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

type MockResolver = (info: { params: Record<string, string>; request: Request }) => Response;
type MockHandler = { method: string; path: string; resolver: MockResolver };

// `msw` es ESM puro y jest no lo carga: este doble conserva la ruta y el resolver.
jest.mock("msw", () => {
  const register =
    (method: string) =>
    (path: string, resolver: MockResolver): MockHandler => ({ method, path, resolver });

  return {
    http: {
      delete: register("DELETE"),
      get: register("GET"),
      patch: register("PATCH"),
      post: register("POST"),
      put: register("PUT"),
    },
    HttpResponse: {
      json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
    },
  };
});

jest.mock("./page", () => ({ ReportsListPage: () => null }));

// Sin `import`: `.storybook/` queda fuera de `npm run typecheck` y un import lo metería.
const { mswHandlers: handlers } = jest.requireActual<{ mswHandlers: MockHandler[] }>(
  "../../../../.storybook/msw-handlers",
);

type Story = { parameters?: { nextjs?: { navigation?: { query?: Record<string, string> } } } };
type StoryModule = Record<string, Story> & {
  default: { beforeEach?: () => void; parameters: { nextjs: unknown } };
};

const stories = jest.requireActual<StoryModule>("./page.stories");

type ReportPage = {
  byHour?: unknown[];
  items: unknown[];
  matrix?: unknown[][];
  series?: { totals: { current: Record<string, number> } };
  summary?: { buckets?: unknown[]; paymentCount: number };
  total?: number;
  totals?: unknown;
};

async function mockedGet(pathname: string, query: Record<string, string>) {
  const handler = handlers.find((item) => item.method === "GET" && item.path === pathname);

  if (!handler) {
    throw new Error(`Sin handler para GET ${pathname}`);
  }

  const request = new Request(`http://localhost${pathname}?${new URLSearchParams(query)}`);
  const response = handler.resolver({ params: {}, request });

  return { data: ((await response.json()) as { data: ReportPage }).data, status: response.status };
}

describe("Storybook · stories de /reports", () => {
  let today: string;
  let last30Days: { from: string; to: string };

  beforeAll(() => {
    stories.default.beforeEach?.();
    today = getCaracasIsoDate();
    last30Days = {
      from: new Date(Date.parse(`${today}T12:00:00.000Z`) - 29 * 86_400_000).toISOString().slice(0, 10),
      to: today,
    };
  });

  it("usan el router de app y el hoy de los datos de prueba", () => {
    expect(stories.default.parameters.nextjs).toEqual({
      appDirectory: true,
      navigation: { pathname: "/reports" },
    });
    expect(today).toBe("2026-05-18");
  });

  it("Default (ventas diarias, últimos 30 días) trae una serie con ventas", async () => {
    const { data } = await mockedGet("/api/reports/daily-sales", { ...last30Days, groupBy: "auto" });

    expect(data.series?.totals.current.totalRef).toBeGreaterThan(0);
  });

  it("SeriesWithCompare (ganancia bruta por semana) trae una serie con ganancia", async () => {
    expect(stories.SeriesWithCompare.parameters?.nextjs?.navigation?.query).toEqual({
      compare: "1",
      groupBy: "week",
      preset: "last_30_days",
      report: "gross-profit",
    });

    const { data } = await mockedGet("/api/reports/gross-profit", {
      ...last30Days,
      compare: "1",
      groupBy: "week",
    });

    expect(data.series?.totals.current.grossProfitRef).toBeGreaterThan(0);
  });

  it("Ranking (top clientes de este mes) trae filas para las barras", async () => {
    const { data } = await mockedGet("/api/reports/top-customers", {
      from: `${today.slice(0, 8)}01`,
      to: today,
    });

    expect(data.items.length).toBeGreaterThan(0);
  });

  describe("reportes de dinero (REP-06b)", () => {
    it("hay una story por reporte nuevo, cada una con su `report` en la URL", () => {
      const reportOf = (story: Story) => story.parameters?.nextjs?.navigation?.query?.report;

      expect(reportOf(stories.SalesByHour)).toBe("sales-by-hour");
      expect(reportOf(stories.SalesByCategory)).toBe("sales-by-category");
      expect(reportOf(stories.ReceivablesAging)).toBe("receivables-aging");
      expect(reportOf(stories.PayablesAging)).toBe("payables-aging");
      expect(reportOf(stories.CashCloseDifferences)).toBe("cash-close-differences");
    });

    it("ventas por hora: matriz 7 × 24 con ventas en los últimos 30 días", async () => {
      const { data, status } = await mockedGet("/api/reports/sales-by-hour", last30Days);

      expect(status).toBe(200);
      expect(data.matrix).toHaveLength(7);
      expect(data.matrix?.[0]).toHaveLength(24);
      expect(data.byHour).toHaveLength(24);
      expect((data.totals as { salesCount: number }).salesCount).toBeGreaterThan(0);
    });

    it("ventas por categoría: trae categorías con ingreso", async () => {
      const { data, status } = await mockedGet("/api/reports/sales-by-category", last30Days);

      expect(status).toBe(200);
      expect(data.items.length).toBeGreaterThan(0);
      expect((data.totals as { revenueRef: number }).revenueRef).toBeGreaterThan(0);
    });

    it.each(["receivables-aging", "payables-aging"])("%s: página y resumen de tres tramos", async (slug) => {
      const { data, status } = await mockedGet(`/api/reports/${slug}`, { limit: "10", skip: "0" });

      expect(status).toBe(200);
      expect(data.summary?.buckets).toHaveLength(3);
      expect(data.items.length).toBeLessThanOrEqual(10);
      expect(typeof data.total).toBe("number");
    });

    it("cuentas por pagar acepta el tramo de la story y rechaza uno inventado", async () => {
      expect((await mockedGet("/api/reports/payables-aging", { bucket: "30+" })).status).toBe(200);
      expect((await mockedGet("/api/reports/payables-aging", { bucket: "31-60" })).status).toBe(400);
    });

    it("diferencias de cierre: totales por moneda, y una moneda inventada es 400", async () => {
      const { data, status } = await mockedGet("/api/reports/cash-close-differences", { currency: "ves" });

      expect(status).toBe(200);
      expect(data.totals).toHaveLength(2);
      expect((await mockedGet("/api/reports/cash-close-differences", { currency: "usd" })).status).toBe(400);
    });

    it("ventas por hora sin rango responde 400, como la ruta", async () => {
      expect((await mockedGet("/api/reports/sales-by-hour", {})).status).toBe(400);
    });
  });

  it("métodos de pago tiene handler y trae pagos (antes 404)", async () => {
    const { data, status } = await mockedGet("/api/reports/payment-methods", {
      ...last30Days,
      compare: "1",
    });

    expect(status).toBe(200);
    expect(data.summary?.paymentCount).toBeGreaterThan(0);
  });
});
