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
  byReason?: { reason: string }[];
  groupBy?: string;
  inventoryBasis?: string;
  costBasis?: string;
  items: unknown[];
  matrix?: unknown[][];
  series?: { totals: { current: Record<string, number> } };
  summary?: { buckets?: unknown[]; paymentCount: number; productsCount?: number };
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

  describe("reportes de inventario (REP-07b)", () => {
    it("hay una story por reporte nuevo, cada una con su `report` en la URL", () => {
      const queryOf = (story: Story) => story.parameters?.nextjs?.navigation?.query;

      expect(queryOf(stories.DeadStock)).toEqual({ days: "1", report: "dead-stock" });
      expect(queryOf(stories.DeadStockEmpty)).toEqual({ report: "dead-stock" });
      expect(queryOf(stories.DeadStockMobile)).toEqual({ days: "1", report: "dead-stock" });
      expect(queryOf(stories.StockTurnover)?.report).toBe("stock-turnover");
      expect(queryOf(stories.StockTurnoverByCategory)).toEqual({
        preset: "last_30_days",
        report: "stock-turnover",
        turnoverBy: "category",
      });
      expect(queryOf(stories.StockAdjustments)?.report).toBe("stock-adjustments");
      expect(queryOf(stories.PurchasesAllStatuses)?.status).toBe("all");
    });

    it("productos sin movimiento: la story trae productos, la de 30 días es el vacío y `days` se valida", async () => {
      const { data, status } = await mockedGet("/api/reports/dead-stock", { days: "1", limit: "10", skip: "0" });

      expect(status).toBe(200);
      expect(data.items.length).toBeLessThanOrEqual(10);
      expect(data.summary?.productsCount).toBe(data.total);
      expect(data.total).toBeGreaterThan(0);

      // Sin `days` son 30: los datos de prueba no tienen nada parado tanto tiempo.
      const byDefault = await mockedGet("/api/reports/dead-stock", {});

      expect(byDefault.status).toBe(200);
      expect(byDefault.data.total).toBe(0);
      expect((await mockedGet("/api/reports/dead-stock", { days: "0" })).status).toBe(400);
      expect((await mockedGet("/api/reports/dead-stock", { days: "2.5" })).status).toBe(400);
    });

    it("rotación: por producto y por categoría (`groupBy` del endpoint), con totales; sin rango, 400", async () => {
      const byProduct = await mockedGet("/api/reports/stock-turnover", { ...last30Days, groupBy: "product" });
      const byCategory = await mockedGet("/api/reports/stock-turnover", { ...last30Days, groupBy: "category" });

      expect(byProduct.status).toBe(200);
      expect(byProduct.data.groupBy).toBe("product");
      expect(byProduct.data.inventoryBasis).toBe("average_opening_closing");
      expect(byProduct.data.items.length).toBeGreaterThan(0);
      expect(byCategory.status).toBe(200);
      expect(byCategory.data.groupBy).toBe("category");
      // Los totales no dependen de la agrupación.
      expect(byCategory.data.totals).toEqual(byProduct.data.totals);
      expect((await mockedGet("/api/reports/stock-turnover", {})).status).toBe(400);
      expect((await mockedGet("/api/reports/stock-turnover", { ...last30Days, groupBy: "week" })).status).toBe(400);
    });

    it("ajustes y mermas: la story trae movimientos, motivos y una serie sin huecos; sin rango, 400", async () => {
      const { data, status } = await mockedGet("/api/reports/stock-adjustments", {
        ...last30Days,
        groupBy: "auto",
      });

      expect(status).toBe(200);
      expect(data.costBasis).toBe("current_cost");
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.byReason?.length).toBeGreaterThan(0);
      // Aquí series es la lista de periodos, no el objeto de los reportes de serie.
      expect((data.series as unknown as unknown[]).length).toBeGreaterThan(0);
      expect((await mockedGet("/api/reports/stock-adjustments", {})).status).toBe(400);
    });

    it("compras con status=all trae al menos las vigentes; un estado inventado es 400", async () => {
      const byDefault = await mockedGet("/api/reports/purchases", { ...last30Days, groupBy: "auto" });
      const all = await mockedGet("/api/reports/purchases", { ...last30Days, groupBy: "auto", status: "all" });

      expect(all.status).toBe(200);
      expect(all.data.total).toBeGreaterThanOrEqual(byDefault.data.total ?? 0);
      expect((await mockedGet("/api/reports/purchases", { ...last30Days, status: "anulado" })).status).toBe(400);
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
