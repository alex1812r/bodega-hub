/**
 * REP-F6 · las stories del dashboard dejaban `GET /api/auth/me` sin handler
 * (404 en consola): su lista propia de `parameters.msw.handlers` sustituye a la
 * global de Storybook. Sin sesión no hay permisos, y `WithPriceReview` y
 * `WithOverdueReceivables` ni pedían ni pintaban su tarjeta.
 *
 * Aquí se monta la pantalla real y cada petición se resuelve SOLO con los
 * handlers de la story, con la regla de MSW (gana el primero que casa).
 */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

type MockResponse = {
  headers: { get: () => string };
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};
type MockResolver = (info: { request: { url: string } }) => MockResponse | Promise<MockResponse>;
type MockHandler = { method: string; path: string; resolver: MockResolver };

function mockJsonResponse(body: unknown, status = 200): MockResponse {
  return {
    headers: { get: () => "application/json" },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

// `msw` es ESM puro y jest no lo carga: este doble conserva la ruta y el resolver.
jest.mock("msw", () => ({
  delay: () => Promise.resolve(),
  http: {
    get: (path: string, resolver: MockResolver): MockHandler => ({ method: "GET", path, resolver }),
  },
  HttpResponse: {
    json: (body: unknown, init?: { status?: number }) => mockJsonResponse(body, init?.status),
  },
}));
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("./utils/businessDate", () => ({
  ...jest.requireActual("./utils/businessDate"),
  getBusinessTodayIsoDate: () => "2026-05-18",
}));
jest.mock("../../shared/components/TimeSeriesChart", () => ({
  TimeSeriesChart: () => <div data-testid="time-series-chart" />,
}));
jest.mock("../reports/reports-list/components/DailyClosePanel", () => ({
  DailyClosePanel: () => <div data-testid="daily-close" />,
}));

type Story = { parameters?: { msw?: { handlers: MockHandler[] } } };
type StoryModule = Record<string, Story> & {
  default: Story & { beforeEach?: () => void; component: ComponentType };
};

const stories = jest.requireActual<StoryModule>("../../app/dashboard/page.stories");
const DashboardPage = stories.default.component;

describe("Storybook · stories del dashboard montadas con sus propios handlers", () => {
  const requested: string[] = [];
  const unhandled: string[] = [];

  beforeAll(() => {
    stories.default.beforeEach?.();
  });

  beforeEach(() => {
    requested.length = 0;
    unhandled.length = 0;
    window.history.replaceState(null, "", "/dashboard");
  });

  async function renderStory(name: string) {
    const handlers =
      stories[name].parameters?.msw?.handlers ?? stories.default.parameters?.msw?.handlers ?? [];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const handler = handlers.find((item) => item.method === "GET" && item.path === url.pathname);

      requested.push(url.pathname);

      if (!handler) {
        unhandled.push(url.pathname);

        return mockJsonResponse({ error: { code: "NOT_FOUND", message: "Sin handler." } }, 404);
      }

      return handler.resolver({ request: { url: url.toString() } });
    }) as unknown as typeof fetch;

    render(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>,
    );

    await screen.findByTestId("daily-close");
    await waitFor(() => expect(requested).toContain("/api/auth/me"));

    // La sesión habilita las tarjetas por permiso: se espera a que no quede nada en vuelo.
    for (let pass = 0; pass < 3; pass += 1) {
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it.each(["Default", "WithPriceReview", "WithOverdueReceivables", "WithSalesPeaks"])(
    "%s no deja ninguna petición sin handler",
    async (name) => {
      await renderStory(name);

      expect(unhandled).toEqual([]);
      expect(requested).toEqual(
        expect.arrayContaining([
          "/api/auth/me",
          "/api/products/price-review/summary",
          "/api/reports/payment-methods",
          "/api/reports/receivables-aging",
        ]),
      );
    },
  );

  it("WithPriceReview muestra la tarjeta de productos por revisar", async () => {
    await renderStory("WithPriceReview");

    expect(await screen.findByText("3 productos bajaron de ganancia")).toBeInTheDocument();
  });

  it("WithOverdueReceivables muestra la tarjeta de cuentas por cobrar vencidas", async () => {
    await renderStory("WithOverdueReceivables");

    expect(await screen.findByText("Cuentas por cobrar vencidas")).toBeInTheDocument();
    expect(screen.getByText(/3 documentos con más de 30 días/)).toBeInTheDocument();
  });

  it("Default no enseña avisos que sus datos no tienen", async () => {
    await renderStory("Default");

    expect(screen.queryByText(/bajaron de ganancia|bajó de ganancia/)).not.toBeInTheDocument();
  });
});
