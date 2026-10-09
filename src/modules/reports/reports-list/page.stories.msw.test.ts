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
  items: unknown[];
  series?: { totals: { current: Record<string, number> } };
  summary?: { paymentCount: number };
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

  it("métodos de pago tiene handler y trae pagos (antes 404)", async () => {
    const { data, status } = await mockedGet("/api/reports/payment-methods", {
      ...last30Days,
      compare: "1",
    });

    expect(status).toBe(200);
    expect(data.summary?.paymentCount).toBeGreaterThan(0);
  });
});
