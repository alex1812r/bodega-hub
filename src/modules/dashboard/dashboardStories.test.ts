/**
 * @jest-environment node
 *
 * REP-F2 · las 5 stories del dashboard no renderizaban: el dashboard lee el
 * periodo de la URL (`useUrlListState`) y las stories no declaraban el router de
 * app, así que `useSearchParams()` devolvía `null`. Además Storybook fija el
 * reloj en 2024 y los datos de prueba son de mayo de 2026.
 */
import { getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

type MockResolver = (info: { request: Request }) => Response;
type MockHandler = { method: string; path: string; resolver: MockResolver };

// `msw` es ESM puro y jest no lo carga: este doble conserva la ruta y el resolver.
jest.mock("msw", () => ({
  delay: () => Promise.resolve(),
  http: {
    get: (path: string, resolver: MockResolver): MockHandler => ({ method: "GET", path, resolver }),
  },
  HttpResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));

jest.mock("../../app/dashboard/page", () => ({ __esModule: true, default: () => null }));

type Story = { parameters?: { msw?: { handlers: MockHandler[] }; nextjs?: unknown } };
type StoryModule = Record<string, Story> & { default: Story & { beforeEach?: () => void } };

const stories = jest.requireActual<StoryModule>("../../app/dashboard/page.stories");
const STORY_NAMES = [
  "Default",
  "WithPriceReview",
  "WithOverdueReceivables",
  "WithSalesPeaks",
  "Loading",
  "Error",
];

async function storyGet(story: Story, pathname: string, query = "") {
  const handler = story.parameters?.msw?.handlers.find((item) => item.path === pathname);

  if (!handler) {
    throw new Error(`Sin handler para GET ${pathname}`);
  }

  const response = handler.resolver({ request: new Request(`http://localhost${pathname}?${query}`) });

  return ((await response.json()) as { data: unknown }).data;
}

describe("Storybook · stories del dashboard", () => {
  beforeAll(() => {
    stories.default.beforeEach?.();
  });

  it("están las seis y todas heredan el router de app con la ruta del dashboard", () => {
    expect(Object.keys(stories).filter((name) => name !== "default").sort()).toEqual(
      [...STORY_NAMES].sort(),
    );
    expect(stories.default.parameters?.nextjs).toEqual({
      appDirectory: true,
      navigation: { pathname: "/dashboard" },
    });

    for (const name of STORY_NAMES) {
      expect(stories[name].parameters?.nextjs).toBeUndefined();
    }
  });

  it("el hoy de las stories es el de los datos de prueba", () => {
    expect(getCaracasIsoDate()).toBe("2026-05-18");
  });

  it("WithSalesPeaks dibuja una semana con picos y su periodo anterior", async () => {
    const trend = (await storyGet(
      stories.WithSalesPeaks,
      "/api/dashboard/sales-trend",
      "from=2026-05-12&to=2026-05-18&groupBy=day&compare=1",
    )) as { items: { totalRef: number }[]; series: { previous: unknown[] | null } | null };
    const values = trend.items.map((item) => item.totalRef);

    expect(values).toHaveLength(7);
    expect(Math.max(...values)).toBeGreaterThan(2 * Math.min(...values));
    expect(trend.series?.previous).toHaveLength(7);
  });

  it("WithOverdueReceivables responde documentos de más de 30 días y de 8 a 30", async () => {
    const report = (await storyGet(stories.WithOverdueReceivables, "/api/reports/receivables-aging")) as {
      summary: { buckets: { bucket: string; documentsCount: number }[] };
    };

    expect(report.summary.buckets.map((row) => [row.bucket, row.documentsCount])).toEqual([
      ["0-7", 6],
      ["8-30", 4],
      ["30+", 3],
    ]);
  });

  it("WithPriceReview responde 3 productos por revisar", async () => {
    expect(await storyGet(stories.WithPriceReview, "/api/products/price-review/summary")).toEqual({
      total: 3,
    });
  });
});
