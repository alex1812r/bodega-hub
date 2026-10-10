/**
 * INT-05 · `/reports` como listado nº 12 de DET-06: reporte activo, rango (propio
 * o `preset`), agrupación y página viven en la URL, viajan en el `returnTo` de
 * los enlaces a documentos y, al volver del detalle (o al recargar, o al pegar
 * la URL en otra pestaña), la pantalla pide exactamente lo mismo.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";

import type { Permission } from "@/shared/auth/permissions";
import { dateRangeChip, dateRangeLabel } from "@/shared/components/DateRangeField/testing";

import * as inventoryHooks from "../hooks/useInventoryReports";
import * as reportsHooks from "../hooks/useReports";
import type { StockAdjustmentInput } from "../services/inventoryReports";
import { REPORTS_TABLE_OPEN_KEY } from "./hooks/useSessionSectionOpen";

type AdjustmentsRequest = {
  from?: string;
  groupBy?: "auto" | "day" | "month" | "week";
  limit?: number;
  skip?: number;
  to?: string;
};

// Hoy operativo fijo: los presets relativos del rango se calculan con él.
jest.mock("../../dashboard/utils/businessDate", () => ({
  getBusinessTodayIsoDate: () => "2026-10-09",
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock("../../../shared/auth/usePermission", () => {
  const permissions: Permission[] = jest
    .requireActual("../../../shared/auth/permissions")
    .getRolePermissions("admin");

  return {
    usePermission: () => ({
      can: (permission: Permission) => permissions.includes(permission),
      isLoading: false,
      permissions,
      role: "admin",
    }),
  };
});

jest.mock("../hooks/useInventoryReports", () => {
  const { buildStockAdjustmentsReport } = jest.requireActual("../services/inventoryReports");
  const idle = () => ({ data: undefined, error: null, isFetching: false, isLoading: false, refetch: jest.fn() });
  // Como react-query: la misma consulta devuelve siempre el mismo objeto `data`.
  const cache = new Map<string, unknown>();
  // 25 ajustes en septiembre de 2026 y 15 en octubre (del 1 al 9 hay 9): uno por día.
  const day = (month: string, index: number) => `2026-${month}-${String(index + 1).padStart(2, "0")}`;
  const rows: StockAdjustmentInput[] = [
    ...Array.from({ length: 25 }, (_, index) => day("09", index)),
    ...Array.from({ length: 15 }, (_, index) => day("10", index)),
  ].map((date, index) => ({
    createdAt: `${date}T15:00:00.000Z`,
    date,
    movementId: `mov-${index + 1}`,
    productId: `prod-${index + 1}`,
    productName: `Producto ${index + 1}`,
    quantityDelta: -1,
    reason: "Merma",
    seq: index + 1,
    sku: `SKU-${index + 1}`,
    type: "ajuste_salida",
    unitCostRef: 2,
    valueRef: -2,
  }));

  return {
    useDeadStockReport: jest.fn(idle),
    useStockAdjustmentsReport: jest.fn((filters: AdjustmentsRequest = {}) => {
      if (!filters.from || !filters.to) {
        return idle();
      }

      const key = JSON.stringify(filters);

      if (!cache.has(key)) {
        cache.set(
          key,
          buildStockAdjustmentsReport({
            query: {
              from: filters.from,
              groupBy: !filters.groupBy || filters.groupBy === "auto" ? null : filters.groupBy,
              limit: filters.limit ?? 10,
              skip: filters.skip ?? 0,
              to: filters.to,
            },
            rows,
          }),
        );
      }

      return { ...idle(), data: cache.get(key) };
    }),
    useStockTurnoverReport: jest.fn(idle),
  };
});

jest.mock("../hooks/useReports", () => {
  const empty = () => ({
    data: { items: [], limit: 10, skip: 0, total: 0 },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });

  return {
    ...jest.requireActual("../hooks/useReports"),
    useDailySalesReport: jest.fn(empty),
  };
});

jest.mock("./components/ReportsExportActions", () => ({
  ReportsExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <pre data-testid="export-filters">{JSON.stringify(exportFilters)}</pre>
  ),
}));

import { ReportsListPage } from "./page";

const hooks = jest.mocked(inventoryHooks);
const reports = jest.mocked(reportsHooks);

function renderPage(search: string) {
  window.history.replaceState(null, "", `/reports${search}`);

  return render(<ReportsListPage />);
}

/** `returnTo` que lleva el enlace: la URL a la que vuelve «Volver» del detalle. */
function returnToOf(link: HTMLElement) {
  return new URL(link.getAttribute("href") ?? "", "http://localhost").searchParams.get("returnTo");
}

describe("ReportsListPage · detalle → Volver y recarga (INT-05, DET-06 nº 12)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    jest.clearAllMocks();
    // GQ-02: «Tabla de datos» abre plegada. Estos casos leen la tabla: parten de una sesión que la dejó desplegada.
    window.sessionStorage.setItem(REPORTS_TABLE_OPEN_KEY, "open");
    // Escritorio: la paginación muestra sus botones.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: !query.includes("max-width"),
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
      writable: true,
    });
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it.each([
    {
      chip: "Mes pasado",
      expectedRequest: { from: "2026-09-01", groupBy: "week", limit: 10, skip: 10, to: "2026-09-30" },
      kind: "preset",
      label: "1–30 sep 2026",
      // De los 25 ajustes de septiembre, la página 2 empieza en el 11.º más reciente.
      product: "Producto 15",
      search: "?report=stock-adjustments&preset=last_month&groupBy=week&page=2",
    },
    {
      chip: "Personalizado",
      expectedRequest: { from: "2026-09-10", groupBy: "week", limit: 10, skip: 10, to: "2026-10-05" },
      kind: "rango propio",
      label: "10 sep – 5 oct 2026",
      // 16 de septiembre + 5 de octubre: la página 2 empieza en el 11.º más reciente.
      product: "Producto 20",
      search: "?report=stock-adjustments&from=2026-09-10&to=2026-10-05&groupBy=week&page=2",
    },
  ])(
    "con $kind: el enlace al producto lleva la URL exacta y volver a ella pide lo mismo",
    ({ chip, expectedRequest, label, product, search }) => {
      const first = renderPage(search);
      const link = within(screen.getByRole("table")).getByRole("link", { name: product });
      const returnTo = returnToOf(link);

      // El enlace sale al detalle con `returnTo` = la URL de la lista, tal cual.
      expect(link.getAttribute("href")?.startsWith("/products/prod-")).toBe(true);
      expect(returnTo).toBe(`/reports${search}`);
      expect(hooks.useStockAdjustmentsReport).toHaveBeenLastCalledWith(expectedRequest);

      first.unmount();
      jest.clearAllMocks();

      // «Volver» del detalle, una recarga y la URL pegada en otra pestaña abren esa misma URL.
      renderPage((returnTo ?? "").slice("/reports".length));

      expect(screen.getByRole("button", { name: /^Reporte: / })).toHaveTextContent("Ajustes y mermas");
      expect(dateRangeLabel()).toHaveTextContent(label);
      expect(dateRangeChip(chip)).toHaveAttribute("aria-pressed", "true");
      expect(
        within(screen.getByRole("group", { name: "Agrupar por" })).getByRole("button", { name: "Semana" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(hooks.useStockAdjustmentsReport).toHaveBeenLastCalledWith(expectedRequest);
      // La misma página: la misma primera fila.
      expect(within(screen.getByRole("table")).getByRole("link", { name: product })).toBeInTheDocument();
      // Nada se reescribe al montar: la URL sigue siendo la que se pegó.
      expect(`${window.location.pathname}${window.location.search}`).toBe(returnTo);
    },
  );

  it("un reporte de serie recargado conserva reporte, preset, agrupación, comparación y página", () => {
    renderPage("?report=daily-sales&preset=last_month&groupBy=week&compare=1&page=3&limit=20");

    expect(screen.getByRole("button", { name: /^Reporte: / })).toHaveTextContent("Ventas diarias");
    expect(dateRangeChip("Mes pasado")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" })).toBeChecked();
    expect(reports.useDailySalesReport).toHaveBeenLastCalledWith(
      { compare: true, from: "2026-09-01", groupBy: "week", limit: 20, skip: 40, to: "2026-09-30" },
      undefined,
    );
    expect(window.location.search).toBe(
      "?report=daily-sales&preset=last_month&groupBy=week&compare=1&page=3&limit=20",
    );
  });
});
