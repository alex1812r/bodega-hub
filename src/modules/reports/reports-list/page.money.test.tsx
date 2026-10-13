/**
 * REP-06b · `/reports` con los cinco reportes de dinero: el catálogo solo ofrece
 * los que la sesión puede abrir, una URL directa sin permiso da el 403 del tema
 * sin pedir nada, y tramo, contacto, moneda y página viven en la URL (regla 15).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission, UserRole } from "@/shared/auth/permissions";

import * as moneyHooks from "../hooks/useMoneyReports";
import {
  buildAgingSummary,
  type AgingBucket,
  type AgingDocumentRow,
} from "../services/moneyReports";
import { moneyReportCatalog, reportCatalog, storeReportCatalog } from "./config/reportCatalog";
import { REPORTS_TABLE_OPEN_KEY } from "./hooks/useSessionSectionOpen";

type AgingRequest = { bucket?: AgingBucket; contactId?: string; limit?: number; skip?: number };

let mockRole: UserRole | undefined = "admin";
let mockIsLoading = false;
/** Documentos pendientes que «tiene» el servidor. */
let mockAgingTotal = 35;

function mockPermissions(): Permission[] {
  return mockRole ? jest.requireActual("../../../shared/auth/permissions").getRolePermissions(mockRole) : [];
}

jest.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockPermissions().includes(permission),
    isLoading: mockIsLoading,
    permissions: mockPermissions(),
    role: mockRole,
  }),
}));

jest.mock("../hooks/useMoneyReports", () => {
  const idle = () => ({ data: undefined, error: null, isFetching: false, isLoading: false, refetch: jest.fn() });
  // Como react-query: la misma consulta devuelve siempre el mismo objeto `data`.
  const cache = new Map<string, unknown>();
  const cached = <T,>(key: string, build: () => T) => {
    if (!cache.has(key)) {
      cache.set(key, build());
    }

    return cache.get(key) as T;
  };
  /** Como el servidor: devuelve solo la página pedida y el resumen de todo el conjunto. */
  const aging = (type: "purchase" | "sale") => (filters: AgingRequest = {}) =>
    cached(JSON.stringify([type, filters, mockAgingTotal]), () => buildAging(type, filters));
  const buildAging = (type: "purchase" | "sale", filters: AgingRequest) => {
    const limit = filters.limit ?? 10;
    const skip = filters.skip ?? 0;
    const count = Math.max(0, Math.min(limit, mockAgingTotal - skip));
    const items: AgingDocumentRow[] = Array.from({ length: count }, (_, index) => {
      const position = skip + index + 1;

      return {
        bucket: filters.bucket ?? "8-30",
        contact: { id: `contacto-${position}`, name: `Contacto ${position}` },
        createdAt: "2026-05-10T15:00:00.000Z",
        date: "2026-05-10",
        days: 8,
        document: {
          href: `/${type === "sale" ? "sales" : "purchases"}/doc-${position}`,
          id: `doc-${position}`,
          number: `DOC-${position}`,
          type,
        },
        paidRef: 0,
        paidVes: 0,
        pendingRef: 10,
        pendingVes: 400,
        refRateVes: 40,
        totalRef: 10,
        totalVes: 400,
      };
    });

    return {
      ...idle(),
      data: {
        items,
        limit,
        skip,
        summary: buildAgingSummary([
          { bucket: "0-7", documentsCount: 5, pendingRef: 50, pendingVes: 2000 },
          { bucket: "8-30", documentsCount: mockAgingTotal, pendingRef: 350, pendingVes: 14000 },
          { bucket: "30+", documentsCount: 2, pendingRef: 20, pendingVes: 800 },
        ]),
        total: mockAgingTotal,
      },
    };
  };

  return {
    useCashCloseDifferencesReport: jest.fn(() => ({
      ...idle(),
      data: {
        items: [],
        limit: 10,
        range: { from: null, to: null },
        skip: 0,
        total: 0,
        totals: [
          { counted: 0, currency: "ves", difference: 0, expected: 0, sessionsCount: 0 },
          { counted: 0, currency: "ref", difference: 0, expected: 0, sessionsCount: 0 },
        ],
      },
    })),
    usePayablesAgingReport: jest.fn(aging("purchase")),
    useReceivablesAgingReport: jest.fn(aging("sale")),
    useSalesByCategoryReport: jest.fn(idle),
    useSalesByHourReport: jest.fn(idle),
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

  return { ...jest.requireActual("../hooks/useReports"), useDailySalesReport: jest.fn(empty) };
});

jest.mock("../../contacts/hooks/useContacts", () => ({
  useContact: (id?: string) => ({ data: id ? { id, name: `Contacto ${id}` } : undefined, error: null }),
}));

jest.mock("../../../shared/components/EntityAutocomplete", () => ({
  EntityAutocomplete: ({
    label,
    onChange,
    value,
  }: {
    label: string;
    onChange: (option: { id: string; label: string } | null) => void;
    value: { id: string; label: string } | null;
  }) => (
    <div data-testid="contact-filter">
      <span>
        {label}: {value?.label ?? "todos"}
      </span>
      <button onClick={() => onChange({ id: "c-9", label: "Elegido" })} type="button">
        Elegir contacto
      </button>
    </div>
  ),
}));

jest.mock("./components/ReportsExportActions", () => ({
  ReportsExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <pre data-testid="export-filters">{JSON.stringify(exportFilters)}</pre>
  ),
}));

import { ReportsListPage } from "./page";

const hooks = jest.mocked(moneyHooks);
const MONEY_HOOKS = [
  "useCashCloseDifferencesReport",
  "usePayablesAgingReport",
  "useReceivablesAgingReport",
  "useSalesByCategoryReport",
  "useSalesByHourReport",
] as const;

function renderPage(search = "") {
  window.history.replaceState(null, "", `/reports${search}`);

  return render(<ReportsListPage />);
}

function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

function catalogToggle() {
  return screen.getByRole("button", { name: /^Reporte: / });
}

async function openCatalog(user: ReturnType<typeof userEvent.setup>) {
  if (catalogToggle().getAttribute("aria-expanded") !== "true") {
    await user.click(catalogToggle());
  }

  return screen.getByRole("navigation", { name: "Catálogo de reportes" });
}

function catalogNames(catalog: HTMLElement) {
  return within(catalog)
    .getAllByRole("button")
    .map((button) => button.querySelector("span > span")?.textContent ?? "");
}

describe("ReportsListPage · reportes de dinero (REP-06b)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    jest.clearAllMocks();
    // GQ-02: «Tabla de datos» abre plegada. Estos casos leen la tabla: parten de una sesión que la dejó desplegada.
    window.sessionStorage.setItem(REPORTS_TABLE_OPEN_KEY, "open");
    mockRole = "admin";
    mockIsLoading = false;
    mockAgingTotal = 35;
    // Escritorio: la paginación muestra sus botones, el catálogo no se pliega.
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

  describe("catálogo según permisos", () => {
    it("administrador: los cinco reportes nuevos aparecen en Ventas y en Dinero", async () => {
      const user = userEvent.setup();
      renderPage();

      const catalog = await openCatalog(user);

      expect(within(catalog).getAllByRole("button")).toHaveLength(storeReportCatalog.length);

      const ventas = within(screen.getByRole("region", { name: "Ventas" }));
      const dinero = within(screen.getByRole("region", { name: "Dinero" }));

      expect(ventas.getByRole("button", { name: /^Ventas por hora y día de la semana/ })).toBeInTheDocument();
      expect(ventas.getByRole("button", { name: /^Ventas y margen por categoría/ })).toBeInTheDocument();
      expect(dinero.getByRole("button", { name: /^Cuentas por cobrar/ })).toBeInTheDocument();
      expect(dinero.getByRole("button", { name: /^Cuentas por pagar/ })).toBeInTheDocument();
      expect(dinero.getByRole("button", { name: /^Diferencias de cierre de caja/ })).toBeInTheDocument();
    });

    it.each(["vendedor", "almacen"] as const)("%s: ninguno de los cinco se ofrece", async (role) => {
      mockRole = role;
      const user = userEvent.setup();
      renderPage();

      const names = catalogNames(await openCatalog(user));

      expect(names).toHaveLength(reportCatalog.length);
      for (const report of moneyReportCatalog) {
        expect(names).not.toContain(report.name);
      }
    });

    it("mientras carga la sesión tampoco se ofrecen", async () => {
      mockIsLoading = true;
      mockRole = undefined;
      const user = userEvent.setup();
      renderPage();

      expect(catalogNames(await openCatalog(user))).toHaveLength(reportCatalog.length);
    });

    it.each(moneyReportCatalog.map((report) => [report.id, report.name] as const))(
      "URL directa a %s sin permiso: 403 del tema y ninguna petición",
      (id, name) => {
        mockRole = "almacen";
        renderPage(`?report=${id}&from=2026-05-01&to=2026-05-10`);

        expect(screen.getByTestId("report-forbidden")).toHaveTextContent(`No tienes permiso para ver «${name}»`);
        for (const hook of MONEY_HOOKS) {
          expect(hooks[hook]).not.toHaveBeenCalled();
        }
        // La URL no se toca: al recibir el permiso, el mismo enlace abre el reporte.
        expect(urlParams().report).toBe(id);
      },
    );
  });

  describe("cuentas por cobrar: tramo, contacto y página en la URL", () => {
    it("la URL trae tramo, contacto, página y tamaño: se piden tal cual al servidor", () => {
      renderPage("?report=receivables-aging&bucket=30%2B&contactId=cli-1&page=2&limit=25");

      expect(hooks.useReceivablesAgingReport).toHaveBeenLastCalledWith({
        bucket: "30+",
        contactId: "cli-1",
        limit: 25,
        skip: 25,
      });
      expect(screen.getByRole("button", { name: /^Más de 30 días/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("contact-filter")).toHaveTextContent("Cliente: Contacto cli-1");
      // No usa rango de fechas.
      expect(screen.getByText("Este reporte no usa rango de fechas.")).toBeInTheDocument();
    });

    it("pulsar un tramo escribe `bucket`, vuelve a la página 1 y pide esa página", async () => {
      const user = userEvent.setup();
      renderPage("?report=receivables-aging&page=3");

      expect(hooks.useReceivablesAgingReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ bucket: undefined, skip: 20 }),
      );

      await user.click(screen.getByRole("button", { name: /^8 a 30 días/ }));

      await waitFor(() => expect(urlParams()).toEqual({ bucket: "8-30", report: "receivables-aging" }));
      expect(hooks.useReceivablesAgingReport).toHaveBeenLastCalledWith({
        bucket: "8-30",
        contactId: undefined,
        limit: 10,
        skip: 0,
      });
      expect(screen.getByRole("button", { name: /^8 a 30 días/ })).toHaveAttribute("aria-pressed", "true");

      // Pulsar el tramo activo lo quita de la URL.
      await user.click(screen.getByRole("button", { name: /^8 a 30 días/ }));
      await waitFor(() => expect(urlParams()).toEqual({ report: "receivables-aging" }));
    });

    it("paginar escribe `page` y pide `skip` / `limit` al servidor: nunca llega más de una página", async () => {
      mockAgingTotal = 10_000;
      const user = userEvent.setup();
      renderPage("?report=receivables-aging");

      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(11);

      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      await waitFor(() => expect(urlParams()).toEqual({ page: "2", report: "receivables-aging" }));
      expect(hooks.useReceivablesAgingReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 10, skip: 10 }),
      );
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(11);
      expect(screen.getByRole("link", { name: "DOC-11" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "DOC-1" })).not.toBeInTheDocument();
      for (const call of hooks.useReceivablesAgingReport.mock.calls) {
        expect(call[0]?.limit).toBeLessThanOrEqual(100);
      }
    });

    it("los enlaces llevan en `returnTo` la URL actual de la lista, con sus filtros", () => {
      renderPage("?report=receivables-aging&bucket=8-30&page=2");

      const returnTo = encodeURIComponent("/reports?report=receivables-aging&bucket=8-30&page=2");

      expect(screen.getByRole("link", { name: "DOC-11" })).toHaveAttribute(
        "href",
        `/sales/doc-11?returnTo=${returnTo}`,
      );
      expect(screen.getByRole("link", { name: "Contacto 11" })).toHaveAttribute(
        "href",
        `/contacts/contacto-11?returnTo=${returnTo}`,
      );
    });

    it("elegir un contacto escribe `contactId` y vuelve a la página 1", async () => {
      const user = userEvent.setup();
      renderPage("?report=receivables-aging&page=2");

      await user.click(screen.getByRole("button", { name: "Elegir contacto" }));

      await waitFor(() => expect(urlParams()).toEqual({ contactId: "c-9", report: "receivables-aging" }));
      expect(hooks.useReceivablesAgingReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ contactId: "c-9", skip: 0 }),
      );
    });

    it("cambiar a cuentas por pagar limpia tramo, contacto y página, y enlaza a compras", async () => {
      const user = userEvent.setup();
      renderPage("?report=receivables-aging&bucket=8-30&contactId=cli-1&page=2");

      const catalog = await openCatalog(user);

      await user.click(within(catalog).getByRole("button", { name: /^Cuentas por pagar/ }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "payables-aging" }));
      expect(hooks.usePayablesAgingReport).toHaveBeenLastCalledWith({
        bucket: undefined,
        contactId: undefined,
        limit: 10,
        skip: 0,
      });
      expect(screen.getByTestId("contact-filter")).toHaveTextContent("Proveedor: todos");
      expect(screen.getByRole("link", { name: "DOC-1" })).toHaveAttribute(
        "href",
        `/purchases/doc-1?returnTo=${encodeURIComponent("/reports?report=payables-aging")}`,
      );
    });
  });

  describe("diferencias de cierre de caja: moneda y rango en la URL", () => {
    it("sin parámetros pide Bs y todos los cierres; el rango es opcional", () => {
      renderPage("?report=cash-close-differences");

      expect(hooks.useCashCloseDifferencesReport).toHaveBeenLastCalledWith({
        currency: "ves",
        from: undefined,
        limit: 10,
        skip: 0,
        to: undefined,
      });
      expect(screen.queryByText("Este reporte no usa rango de fechas.")).not.toBeInTheDocument();
    });

    it("la moneda y el rango de la URL llegan al servidor; cambiar de moneda vuelve a la página 1", async () => {
      const user = userEvent.setup();
      renderPage("?report=cash-close-differences&currency=ref&from=2026-05-01&to=2026-05-10&page=2");

      expect(hooks.useCashCloseDifferencesReport).toHaveBeenCalledWith({
        currency: "ref",
        from: "2026-05-01",
        limit: 10,
        skip: 10,
        to: "2026-05-10",
      });

      const selector = within(screen.getByRole("group", { name: "Moneda" }));

      expect(selector.getByRole("button", { name: "REF" })).toHaveAttribute("aria-pressed", "true");

      await user.click(selector.getByRole("button", { name: "Bs" }));

      // Bs es la moneda por defecto: no se escribe en la URL.
      await waitFor(() =>
        expect(urlParams()).toEqual({ from: "2026-05-01", report: "cash-close-differences", to: "2026-05-10" }),
      );
      expect(hooks.useCashCloseDifferencesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ currency: "ves", skip: 0 }),
      );

      await user.click(selector.getByRole("button", { name: "REF" }));
      await waitFor(() => expect(urlParams().currency).toBe("ref"));
    });

    it("al salir del reporte la moneda no se arrastra", async () => {
      const user = userEvent.setup();
      renderPage("?report=cash-close-differences&currency=ref");

      const catalog = await openCatalog(user);

      await user.click(within(catalog).getByRole("button", { name: /^Cuentas por cobrar/ }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "receivables-aging" }));
    });
  });

  describe("ventas por hora y por categoría: rango de la página", () => {
    it.each([
      ["sales-by-hour", "useSalesByHourReport"],
      ["sales-by-category", "useSalesByCategoryReport"],
    ] as const)("%s sin rango en la URL pide los últimos 30 días, sin escribirlos", (id, hook) => {
      renderPage(`?report=${id}`);

      // Con datos mock el día operativo es 2026-05-18.
      expect(hooks[hook]).toHaveBeenLastCalledWith({ from: "2026-04-19", to: "2026-05-18" });
      expect(urlParams()).toEqual({ report: id });
    });
  });

  it("la exportación sigue recibiendo solo sus filtros de siempre", () => {
    renderPage("?report=receivables-aging&bucket=8-30&contactId=cli-1");

    expect(JSON.parse(screen.getByTestId("export-filters").textContent ?? "{}")).toEqual({
      dateFilters: {},
      purchasesFilters: {},
      stockCardFilters: {},
    });
  });
});
