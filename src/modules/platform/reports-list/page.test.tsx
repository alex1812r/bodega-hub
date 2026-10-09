/**
 * DET-06b · reportes de plataforma: reporte activo, rango, proveedor, producto y
 * alcance de tiendas viven en la URL (regla 15). La pantalla no enlaza a
 * detalles ni pagina: no hay `returnTo` ni `page` que comprobar.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** URL simulada: `useSearchParams` la sigue como hace Next tras un `history.replaceState`. */
const mockNavigation = {
  listeners: new Set<() => void>(),
  query: "",
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => "/platform/reports",
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () =>
      new URLSearchParams(
        react.useSyncExternalStore(
          (listener: () => void) => {
            mockNavigation.listeners.add(listener);

            return () => {
              mockNavigation.listeners.delete(listener);
            };
          },
          () => mockNavigation.query,
        ),
      ),
  };
});
// El panel y la exportación son del módulo Reportes: aquí solo importa qué reciben.
jest.mock("../../reports/reports-list/components/ReportsResultPanel", () => ({
  ReportsResultPanel: ({ report, ...filters }: { report: { id: string } }) => (
    <span data-testid="result-panel">{JSON.stringify({ report: report.id, ...filters })}</span>
  ),
}));
jest.mock("../../reports/reports-list/components/ReportsExportActions", () => ({
  ReportsExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <span data-testid="export-filters">{JSON.stringify(exportFilters)}</span>
  ),
}));

import { PlatformReportsListPage } from "./page";

const STORE_A = "11111111-1111-4111-8111-111111111111";
const STORE_B = "22222222-2222-4222-8222-222222222222";

const stores = [
  { createdAt: "2026-01-15T12:00:00.000Z", id: STORE_A, name: "Tienda A", slug: "a", status: "active", usersCount: 1 },
  { createdAt: "2026-01-15T12:00:00.000Z", id: STORE_B, name: "Tienda B", slug: "b", status: "active", usersCount: 1 },
];

const platformScope = { pathPrefix: "/api/platform/reports" };

describe("PlatformReportsListPage · estado en la URL (DET-06b)", () => {
  const fetchMock = jest.fn();
  const nativeReplaceState = window.history.replaceState.bind(window.history);

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/platform/reports?${query}` : "/platform/reports");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    openAt("");
    // Lo que hace Next con un `replaceState`: reflejar la URL en `useSearchParams`.
    window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      nativeReplaceState(data, unused, url);
      mockNavigation.query = window.location.search.slice(1);
      mockNavigation.listeners.forEach((listener) => listener());
    };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ data: { items: stores, limit: 100, skip: 0, total: stores.length } }),
      ok: true,
      status: 200,
    }));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    window.history.replaceState = nativeReplaceState;
  });

  /** Parámetros de la URL, con los repetidos (`store`) como lista. */
  function urlParams() {
    const params = new URLSearchParams(window.location.search);

    return Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key)]));
  }

  /** Lo que recibe el panel de resultados: el reporte y los filtros de sus peticiones. */
  function panelProps() {
    return JSON.parse(screen.getByTestId("result-panel").textContent ?? "{}") as unknown;
  }

  function exportFilters() {
    return JSON.parse(screen.getByTestId("export-filters").textContent ?? "{}") as unknown;
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <PlatformReportsListPage />
      </QueryClientProvider>,
    );
  }

  it("sin parámetros abre el reporte por defecto para todas las tiendas y sin filtros", () => {
    renderPage();

    expect(screen.getByLabelText("Reporte activo")).toHaveValue("daily-sales");
    expect(screen.getByLabelText("Alcance")).toHaveValue("all");
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
    expect(panelProps()).toEqual({
      dateFilters: {},
      purchasesFilters: {},
      report: "daily-sales",
      scope: { ...platformScope, enabled: true, storeIds: "", storeScope: "all" },
      stockCardFilters: {},
    });
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura reporte, rango, proveedor, producto y alcance", async () => {
    openAt(
      `report=purchases&from=2026-10-01&to=2026-10-31&supplier=cont-1&product=prod-1&scope=selected&store=${STORE_A}&store=${STORE_B}`,
    );
    renderPage();

    expect(screen.getByLabelText("Reporte activo")).toHaveValue("purchases");
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-31");
    expect(screen.getByLabelText("Proveedor")).toHaveValue("cont-1");
    expect(screen.getByLabelText("Producto")).toHaveValue("prod-1");
    expect(screen.getByLabelText("Alcance")).toHaveValue("selected");
    expect(await screen.findByRole("checkbox", { name: /Tienda A/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Tienda B/ })).toBeChecked();

    const expected = {
      dateFilters: { from: "2026-10-01", to: "2026-10-31" },
      purchasesFilters: { from: "2026-10-01", supplierId: "cont-1", to: "2026-10-31" },
      scope: {
        ...platformScope,
        enabled: true,
        storeIds: `${STORE_A},${STORE_B}`,
        storeScope: "selected",
      },
      stockCardFilters: { productId: "prod-1" },
    };

    expect(panelProps()).toEqual({ ...expected, report: "purchases" });
    expect(exportFilters()).toEqual(expected);
  });

  it("cambiar de reporte, rango, proveedor y producto escribe la URL y llega al panel", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.selectOptions(screen.getByLabelText("Reporte activo"), "top-products");
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-09" } });
    await user.type(screen.getByLabelText("Proveedor"), "cont-9");
    await user.type(screen.getByLabelText("Producto"), "prod-9");

    await waitFor(() =>
      expect(urlParams()).toEqual({
        from: ["2026-10-01"],
        product: ["prod-9"],
        report: ["top-products"],
        supplier: ["cont-9"],
        to: ["2026-10-09"],
      }),
    );
    await waitFor(() =>
      expect(panelProps()).toMatchObject({
        dateFilters: { from: "2026-10-01", to: "2026-10-09" },
        purchasesFilters: { from: "2026-10-01", supplierId: "cont-9", to: "2026-10-09" },
        report: "top-products",
        stockCardFilters: { productId: "prod-9" },
      }),
    );
  });

  it("el alcance y las tiendas elegidas se escriben en la URL", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.selectOptions(screen.getByLabelText("Alcance"), "selected");

    expect(urlParams()).toEqual({ scope: ["selected"] });
    expect(screen.queryByTestId("result-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Selecciona al menos una tienda para generar el reporte.")).toBeInTheDocument();

    await user.click(await screen.findByRole("checkbox", { name: /Tienda A/ }));
    await user.click(screen.getByRole("checkbox", { name: /Tienda B/ }));

    expect(urlParams()).toEqual({ scope: ["selected"], store: [STORE_A, STORE_B] });
    expect(panelProps()).toMatchObject({
      scope: { enabled: true, storeIds: `${STORE_A},${STORE_B}`, storeScope: "selected" },
    });

    await user.selectOptions(screen.getByLabelText("Alcance"), "all");

    expect(urlParams()).toEqual({});
    expect(panelProps()).toMatchObject({ scope: { storeIds: "", storeScope: "all" } });
  });

  it("con alcance «una tienda» solo cuenta la primera aunque la URL traiga varias", () => {
    openAt(`scope=one&store=${STORE_B}&store=${STORE_A}`);
    renderPage();

    expect(panelProps()).toMatchObject({
      scope: { enabled: true, storeIds: STORE_B, storeScope: "one" },
    });
  });

  it("con alcance «todas» las tiendas de la URL no viajan", () => {
    openAt(`store=${STORE_A}`);
    renderPage();

    expect(panelProps()).toMatchObject({ scope: { storeIds: "", storeScope: "all" } });
  });

  it("`page=9999`, `sort` y valores desconocidos no rompen: caen al valor por defecto", () => {
    openAt(
      "page=9999&sort=cualquiera&report=inventado&from=ayer&to=2026-02-31&scope=todas&store=no-es-un-id",
    );
    renderPage();

    expect(screen.getByLabelText("Reporte activo")).toHaveValue("daily-sales");
    expect(screen.getByLabelText("Alcance")).toHaveValue("all");
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
    expect(panelProps()).toEqual({
      dateFilters: {},
      purchasesFilters: {},
      report: "daily-sales",
      scope: { ...platformScope, enabled: true, storeIds: "", storeScope: "all" },
      stockCardFilters: {},
    });
  });
});
