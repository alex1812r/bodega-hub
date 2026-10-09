/**
 * REP-06b · los cinco reportes de dinero: datos, vacío, error, 403 sin petición,
 * tramos que filtran, paginación en servidor, enlaces con `returnTo`, mapa de
 * calor sin NaN y signo / etiqueta de la diferencia de cierre.
 *
 * En jest `formatRef` devuelve `ref 120.00` y `formatVesBs`, `Bs. 1.234,00`.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission, UserRole } from "@/shared/auth/permissions";

import * as moneyHooks from "../../../hooks/useMoneyReports";
import {
  buildAgingSummary,
  buildSalesByCategoryReport,
  buildSalesByHourReport,
  type AgingBucket,
  type AgingDocumentRow,
  type AgingReport,
  type CashCloseDifferenceRow,
  type CashCloseDifferencesReport,
} from "../../../services/moneyReports";
import { getReportById, type ReportId } from "../../config/reportCatalog";
import type { MoneyReportFilters } from "../../reportsListParams";
import type { ReportPagination } from "../ReportTable";
import { MoneyReportPanel } from "./MoneyReportPanel";

type QueryState = { data?: unknown; error?: Error | null; isFetching?: boolean; isLoading?: boolean };

let mockRole: UserRole | undefined = "admin";
let mockIsLoading = false;
let mockRemoved: Permission[] = [];
const mockQueries: Partial<Record<keyof typeof moneyHooks, QueryState>> = {};
const mockRefetch = jest.fn();

function mockPermissions(): Permission[] {
  const all: Permission[] = mockRole
    ? jest.requireActual("../../../../../shared/auth/permissions").getRolePermissions(mockRole)
    : [];

  return all.filter((permission) => !mockRemoved.includes(permission));
}

jest.mock("../../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockPermissions().includes(permission),
    isLoading: mockIsLoading,
    permissions: mockPermissions(),
    role: mockRole,
  }),
}));

jest.mock("../../../hooks/useMoneyReports", () => {
  const hook = (name: string) =>
    jest.fn(() => ({
      data: undefined,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: mockRefetch,
      ...mockQueries[name as keyof typeof mockQueries],
    }));

  return {
    useCashCloseDifferencesReport: hook("useCashCloseDifferencesReport"),
    usePayablesAgingReport: hook("usePayablesAgingReport"),
    useReceivablesAgingReport: hook("useReceivablesAgingReport"),
    useSalesByCategoryReport: hook("useSalesByCategoryReport"),
    useSalesByHourReport: hook("useSalesByHourReport"),
  };
});

jest.mock("../../../../contacts/hooks/useContacts", () => ({
  useContact: (id?: string) => ({ data: id ? { id, name: `Contacto ${id}` } : undefined, error: null }),
}));

// El buscador real (búsqueda en servidor, recientes, lector) tiene sus pruebas.
jest.mock("../../../../../shared/components/EntityAutocomplete", () => ({
  EntityAutocomplete: ({
    filters,
    label,
    onChange,
    value,
  }: {
    filters?: { type?: string[] };
    label: string;
    onChange: (option: { id: string; label: string } | null) => void;
    value: { id: string; label: string } | null;
  }) => (
    <div data-contact-types={filters?.type?.join(",")} data-testid="contact-filter">
      <span>
        {label}: {value?.label ?? "todos"}
      </span>
      <button onClick={() => onChange({ id: "c-9", label: "Elegido" })} type="button">
        Elegir contacto
      </button>
      <button onClick={() => onChange(null)} type="button">
        Quitar contacto
      </button>
    </div>
  ),
}));

const hooks = jest.mocked(moneyHooks);
const RANGE = { from: "2026-05-01", to: "2026-05-31" };
const LIST_HREF = "/reports?report=receivables-aging&bucket=8-30&page=2";
const ALL_HOOKS = [
  "useCashCloseDifferencesReport",
  "usePayablesAgingReport",
  "useReceivablesAgingReport",
  "useSalesByCategoryReport",
  "useSalesByHourReport",
] as const;

function expectNoRequest() {
  for (const name of ALL_HOOKS) {
    expect(hooks[name]).not.toHaveBeenCalled();
  }
}

function renderPanel(
  id: ReportId,
  props: {
    dateFilters?: { from?: string; to?: string };
    filters?: MoneyReportFilters;
    onFiltersChange?: (patch: Partial<MoneyReportFilters>) => void;
    pagination?: ReportPagination;
  } = {},
) {
  return render(
    <MoneyReportPanel
      dateFilters={props.dateFilters ?? RANGE}
      filters={props.filters}
      listHref={LIST_HREF}
      onFiltersChange={props.onFiltersChange}
      pagination={props.pagination}
      report={getReportById(id)}
    />,
  );
}

function setViewport(kind: "desktop" | "mobile") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query.includes("max-width") ? kind === "mobile" : kind === "desktop",
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });
}

function agingRow(position: number, bucket: AgingBucket, type: "purchase" | "sale" = "sale"): AgingDocumentRow {
  const id = `doc-${position}`;

  return {
    bucket,
    contact: position === 2 ? null : { id: `contacto-${position}`, name: `Contacto ${position}` },
    createdAt: "2026-05-10T15:00:00.000Z",
    date: "2026-05-10",
    days: position * 9,
    document: {
      href: type === "sale" ? `/sales/${id}` : `/purchases/${id}`,
      id,
      number: `${type === "sale" ? "F" : "C"}-00${position}`,
      type,
    },
    paidRef: 5,
    paidVes: 200,
    pendingRef: 10 * position,
    pendingVes: 400 * position,
    refRateVes: 40,
    totalRef: 10 * position + 5,
    totalVes: 400 * position + 200,
  };
}

function agingReport(
  rows: AgingDocumentRow[],
  page: { limit?: number; skip?: number; total?: number } = {},
): AgingReport {
  return {
    items: rows,
    limit: page.limit ?? 10,
    skip: page.skip ?? 0,
    summary: buildAgingSummary(
      rows.map((row) => ({
        bucket: row.bucket,
        documentsCount: 1,
        pendingRef: row.pendingRef,
        pendingVes: row.pendingVes,
      })),
    ),
    total: page.total ?? rows.length,
  };
}

function closeRow(position: number, difference: number, running: number): CashCloseDifferenceRow {
  return {
    cashSessionId: `sesion-${position}`,
    closeDate: `2026-05-0${position}`,
    closedAt: `2026-05-0${position}T22:00:00.000Z`,
    closedReason: (["manual", "end_of_day", "max_24h"] as const)[position - 1] ?? null,
    counted: 100 + difference,
    currency: "ves",
    difference,
    expected: 100,
    registerId: "caja-1",
    registerName: position === 4 ? null : "Caja principal",
    runningDifference: running,
  };
}

function closeReport(
  rows: CashCloseDifferenceRow[],
  page: { limit?: number; skip?: number; total?: number } = {},
): CashCloseDifferencesReport {
  return {
    items: rows,
    limit: page.limit ?? 10,
    range: { from: RANGE.from, to: RANGE.to },
    skip: page.skip ?? 0,
    total: page.total ?? rows.length,
    totals: [
      { counted: 395, currency: "ves", difference: -5, expected: 400, sessionsCount: rows.length },
      { counted: 52, currency: "ref", difference: 2, expected: 50, sessionsCount: 1 },
    ],
  };
}

function pagination(overrides: Partial<ReportPagination> = {}): ReportPagination {
  return { limit: 10, setLimit: jest.fn(), setSkip: jest.fn(), skip: 0, ...overrides };
}

describe("MoneyReportPanel · REP-06b", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;
  let rectSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockIsLoading = false;
    mockRemoved = [];

    for (const key of Object.keys(mockQueries)) {
      delete mockQueries[key as keyof typeof mockQueries];
    }

    setViewport("desktop");
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    // Recharts mide su contenedor: en jsdom todo mide 0 y no dibuja.
    rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function measure(this: HTMLElement) {
        return (
          this.id === "recharts_measurement_span"
            ? { height: 13, width: (this.textContent ?? "").length * 6.6 }
            : { height: 280, width: 390 }
        ) as DOMRect;
      });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rectSpy.mockRestore();
    warnSpy.mockRestore();
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  describe("permisos: 403 del tema sin pedir nada al servidor", () => {
    it.each([
      ["sales-by-hour", "vendedor", []],
      ["sales-by-category", "almacen", []],
      ["receivables-aging", "vendedor", []],
      ["payables-aging", "contador", ["payments.manage"]],
      ["cash-close-differences", "contador", ["cash.view"]],
    ] as const)("%s con %s: estado sin permiso y ninguna petición", (id, role, removed) => {
      mockRole = role;
      mockRemoved = [...removed];
      renderPanel(id);

      const forbidden = screen.getByTestId("report-forbidden");

      expect(forbidden).toHaveTextContent(`No tienes permiso para ver «${getReportById(id).name}»`);
      expect(forbidden).toHaveTextContent("Pide a un administrador de la tienda que te dé acceso.");
      expectNoRequest();
    });

    it("mientras carga la sesión no pide nada y avisa que está cargando", () => {
      mockIsLoading = true;
      mockRole = undefined;
      renderPanel("receivables-aging");

      expect(screen.getByText("Cargando reporte")).toBeInTheDocument();
      expect(screen.queryByTestId("report-forbidden")).not.toBeInTheDocument();
      expectNoRequest();
    });

    it("un 403 del servidor (permiso retirado con la sesión abierta) también es el estado sin permiso", () => {
      const { ClientApiError } = jest.requireActual("../../../../../shared/api/apiFetch");

      mockQueries.useSalesByCategoryReport = {
        error: new ClientApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion."),
      };
      renderPanel("sales-by-category");

      expect(screen.getByTestId("report-forbidden")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    });
  });

  describe("ventas por hora y día de la semana", () => {
    const report = buildSalesByHourReport(RANGE, [
      { dow: 6, hour: 18, salesCount: 12, totalRef: 340, totalVes: 13600 },
      { dow: 6, hour: 11, salesCount: 4, totalRef: 90, totalVes: 3600 },
      { dow: 2, hour: 18, salesCount: 3, totalRef: 60, totalVes: 2400 },
      { dow: 1, hour: 9, salesCount: 1, totalRef: 15, totalVes: 600 },
    ]);

    it("pide el rango, pinta el mapa 7 × 24 y resalta la hora y el día pico", () => {
      mockQueries.useSalesByHourReport = { data: report };
      renderPanel("sales-by-hour");

      expect(hooks.useSalesByHourReport).toHaveBeenCalledWith(RANGE);
      expect(screen.getByTestId("sales-by-hour-peak")).toHaveTextContent("Hora pico: 18:00 · Día pico: sábado");

      const heatmap = screen.getByRole("table", { name: "Ventas por día de la semana y hora, en REF" });

      expect(within(heatmap).getAllByRole("rowheader")).toHaveLength(7);
      expect(heatmap.querySelectorAll("td[data-heat-cell]")).toHaveLength(7 * 24);
      expect(screen.getByTitle(/^sábado, 18:00: 12 ventas · ref 340\.00 · Bs\. /)).toHaveAttribute(
        "data-heat-cell",
        "5",
      );
      expect(screen.getByTitle(/^lunes, 09:00: 1 venta · ref 15\.00/)).toHaveAttribute("data-heat-cell", "1");
      expect(screen.getByTitle(/^domingo, 03:00: 0 ventas · ref 0\.00/)).toHaveAttribute("data-heat-cell", "0");
      expect(screen.getByTestId("heatmap-legend")).toHaveTextContent("REF vendido · máximo ref 340.00");
      expect(screen.getByText("ref 505.00")).toBeInTheDocument();
    });

    it("la tabla trae ventas, REF y Bs por día y por hora, en orden natural", () => {
      mockQueries.useSalesByHourReport = { data: report };
      renderPanel("sales-by-hour");

      const byDay = within(screen.getByRole("region", { name: "Por día de la semana" }));
      const byHour = within(screen.getByRole("region", { name: "Por hora" }));

      expect(byDay.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
        "Día",
        "Ventas",
        "REF",
        "Bs",
      ]);
      expect(byDay.getAllByRole<HTMLTableRowElement>("row").slice(1).map((row) => row.cells[0]?.textContent)).toEqual([
        "lunes",
        "martes",
        "miércoles",
        "jueves",
        "viernes",
        "sábado",
        "domingo",
      ]);
      expect(within(byDay.getByRole("row", { name: /sábado/ })).getByText("ref 430.00")).toBeInTheDocument();
      expect(byHour.getAllByRole<HTMLTableRowElement>("row")).toHaveLength(25);
      expect(within(byHour.getByRole("row", { name: /18:00/ })).getByText("15")).toBeInTheDocument();
    });

    it("390 px: el mapa se traspone (24 filas × 7 columnas) y conserva el valor de cada celda", () => {
      setViewport("mobile");
      mockQueries.useSalesByHourReport = { data: report };
      renderPanel("sales-by-hour");

      const heatmap = screen.getByRole("table", { name: "Ventas por día de la semana y hora, en REF" });

      expect(within(heatmap).getAllByRole("rowheader")).toHaveLength(24);
      expect(within(heatmap).getAllByRole("columnheader")).toHaveLength(7);
      expect(screen.getByTitle(/^sábado, 18:00: 12 ventas/)).toHaveAttribute("data-heat-cell", "5");
    });

    it("todo en 0: estado vacío, sin mapa, sin picos y sin NaN", () => {
      mockQueries.useSalesByHourReport = { data: buildSalesByHourReport(RANGE, []) };
      const { container } = renderPanel("sales-by-hour");

      expect(screen.getByText("Sin ventas en este periodo")).toBeInTheDocument();
      expect(screen.queryByTestId("sales-by-hour-peak")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    });

    it("ventas de importe 0: el mapa se dibuja sin intensidad y sin NaN", () => {
      mockQueries.useSalesByHourReport = {
        data: buildSalesByHourReport(RANGE, [{ dow: 3, hour: 10, salesCount: 2, totalRef: 0, totalVes: 0 }]),
      };
      const { container } = renderPanel("sales-by-hour");
      const heatmap = screen.getByRole("table", { name: "Ventas por día de la semana y hora, en REF" });

      expect(heatmap.querySelectorAll('td[data-heat-cell="0"]')).toHaveLength(7 * 24);
      expect(screen.getByTestId("sales-by-hour-peak")).toHaveTextContent("Hora pico: 10:00 · Día pico: miércoles");
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("sin rango completo pide que se elija uno", () => {
      renderPanel("sales-by-hour", { dateFilters: {} });

      expect(screen.getByText("Elige un rango de fechas")).toBeInTheDocument();
      expect(hooks.useSalesByHourReport).toHaveBeenCalledWith({ from: undefined, to: undefined });
    });

    it("cargando y error con reintento", async () => {
      mockQueries.useSalesByHourReport = { isLoading: true };
      const view = renderPanel("sales-by-hour");

      expect(screen.getByRole("status", { name: /Cargando/ })).toBeInTheDocument();
      view.unmount();

      mockQueries.useSalesByHourReport = { error: new Error("Sin conexión") };
      renderPanel("sales-by-hour");

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
      expect(screen.getByText("Sin conexión")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("ventas y margen por categoría", () => {
    const report = buildSalesByCategoryReport(RANGE, [
      { categoryId: "cat-1", categoryName: "Víveres", costRef: 60, grossProfitRef: 40, revenueRef: 100, units: 20 },
      { categoryId: "cat-2", categoryName: "Bebidas", costRef: 150, grossProfitRef: 50, revenueRef: 200, units: 35 },
      { categoryId: null, categoryName: "Sin categoría", costRef: 0, grossProfitRef: 10, revenueRef: 10, units: 1 },
    ]);

    it("barras por ingreso en REF, de mayor a menor, y la nota de la categoría", () => {
      mockQueries.useSalesByCategoryReport = { data: report };
      renderPanel("sales-by-category");

      expect(hooks.useSalesByCategoryReport).toHaveBeenCalledWith(RANGE);

      const chart = screen.getByRole("img");

      expect(chart).toHaveAccessibleName(
        expect.stringContaining("1. Bebidas: ref 200.00. 2. Víveres: ref 100.00. 3. Sin categoría: ref 10.00."),
      );
      expect(screen.getByRole("note")).toHaveTextContent("La categoría es la actual del producto.");
      expect(
        within(screen.getByRole("region", { name: "Gráfico: Ventas y margen por categoría" })).getByText(
          "ref 310.00",
        ),
      ).toBeInTheDocument();
    });

    it("la tabla rotula ganancia sobre costo y margen sobre venta, con «—» si no se pueden calcular, y una fila de totales", () => {
      mockQueries.useSalesByCategoryReport = { data: report };
      renderPanel("sales-by-category");

      const table = within(screen.getByRole("table"));

      expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
        "Categoría",
        "Unidades",
        "Ingreso",
        "Costo",
        "Ganancia",
        "Ganancia sobre costo",
        "Margen sobre venta",
      ]);

      const rows = table.getAllByRole<HTMLTableRowElement>("row").slice(1);

      expect(rows.map((row) => row.cells[0]?.textContent)).toEqual([
        "Bebidas",
        "Víveres",
        "Sin categoría",
        "Total",
      ]);
      // Bebidas: 50 / 150 = 33,33 % sobre costo; 50 / 200 = 25 % sobre venta.
      expect(rows[0]).toHaveTextContent(/33,33\s%/);
      expect(rows[0]?.cells[6]).toHaveTextContent(/^25\s%$/);
      // Sin costo no hay ganancia sobre costo.
      expect(rows[2]?.cells[5]).toHaveTextContent(/^—$/);
      expect(rows[2]?.cells[6]).toHaveTextContent(/^100\s%$/);
      // Totales: 310 de ingreso, 210 de costo, 100 de ganancia.
      expect(rows[3]?.cells[2]).toHaveTextContent("ref 310.00");
      expect(rows[3]?.cells[3]).toHaveTextContent("ref 210.00");
      expect(rows[3]?.cells[4]).toHaveTextContent("ref 100.00");
      expect(rows[3]?.cells[6]).toHaveTextContent(/^32,26\s%$/);
    });

    it("vacío, cargando y error", () => {
      mockQueries.useSalesByCategoryReport = { data: buildSalesByCategoryReport(RANGE, []) };
      const empty = renderPanel("sales-by-category");

      expect(screen.getByText("Sin ventas en este periodo")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      empty.unmount();

      mockQueries.useSalesByCategoryReport = { isLoading: true };
      const loading = renderPanel("sales-by-category");

      expect(screen.getByRole("status", { name: /Cargando/ })).toBeInTheDocument();
      loading.unmount();

      mockQueries.useSalesByCategoryReport = { error: new Error("Falló") };
      renderPanel("sales-by-category");

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
    });
  });

  describe.each([
    ["receivables-aging", "useReceivablesAgingReport", "sale", "cliente,ambos", "Nadie te debe"],
    ["payables-aging", "usePayablesAgingReport", "purchase", "proveedor,ambos", "No debes nada"],
  ] as const)("%s", (id, hookName, type, contactTypes, emptyTitle) => {
    const rows = [agingRow(1, "0-7", type), agingRow(2, "8-30", type), agingRow(4, "30+", type)];

    it("tres tramos con documentos y pendiente en REF y Bs, y la nota de antigüedad", () => {
      mockQueries[hookName] = { data: agingReport(rows) };
      renderPanel(id);

      const buckets = within(screen.getByRole("group", { name: "Filtrar por antigüedad" })).getAllByRole("button");

      expect(buckets.map((button) => button.textContent)).toEqual([
        expect.stringMatching(/^0 a 7 díasref 10\.00Bs\. 400,00 · 1 documento$/),
        expect.stringMatching(/^8 a 30 díasref 20\.00Bs\. 800,00 · 1 documento$/),
        expect.stringMatching(/^Más de 30 díasref 40\.00Bs\. 1\.600,00 · 1 documento$/),
      ]);
      expect(buckets.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
      expect(screen.getByRole("note")).toHaveTextContent("La antigüedad se cuenta desde la fecha del documento.");
      expect(screen.getByTestId("contact-filter")).toHaveAttribute("data-contact-types", contactTypes);
    });

    it("el gráfico lleva una barra por tramo en su orden natural, no por valor", () => {
      mockQueries[hookName] = {
        data: agingReport([agingRow(9, "0-7", type), agingRow(2, "8-30", type), agingRow(4, "30+", type)]),
      };
      renderPanel(id);

      expect(screen.getByRole("img")).toHaveAccessibleName(
        expect.stringContaining("0 a 7 días: ref 90.00. 8 a 30 días: ref 20.00. Más de 30 días: ref 40.00."),
      );
    });

    it("el tramo de la URL sale pulsado; pulsar otro lo cambia y pulsar el activo lo quita", async () => {
      const onFiltersChange = jest.fn();

      mockQueries[hookName] = { data: agingReport(rows) };
      renderPanel(id, { filters: { bucket: "8-30", currency: "ves" }, onFiltersChange });

      expect(screen.getByRole("button", { name: /^8 a 30 días/ })).toHaveAttribute("aria-pressed", "true");
      expect(hooks[hookName]).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: "8-30" }));

      await userEvent.click(screen.getByRole("button", { name: /^Más de 30 días/ }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ bucket: "30+" });

      await userEvent.click(screen.getByRole("button", { name: /^8 a 30 días/ }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ bucket: undefined });
    });

    it("pide al servidor solo la página visible (skip y limit), nunca todo", async () => {
      const setSkip = jest.fn();

      mockQueries[hookName] = {
        data: agingReport(rows, { limit: 25, skip: 50, total: 10_000 }),
      };
      renderPanel(id, { pagination: pagination({ limit: 25, setSkip, skip: 50 }) });

      expect(hooks[hookName]).toHaveBeenLastCalledWith({
        bucket: undefined,
        contactId: undefined,
        limit: 25,
        skip: 50,
      });
      expect(screen.getAllByText("Mostrando 51-75 de 10000 registros").length).toBeGreaterThan(0);
      // Solo se pintan las filas que llegaron (más la cabecera).
      expect(within(screen.getByRole("table")).getAllByRole<HTMLTableRowElement>("row")).toHaveLength(rows.length + 1);

      await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      expect(setSkip).toHaveBeenCalledWith(75);
    });

    it("una página que ya no existe vuelve a la primera", () => {
      const setSkip = jest.fn();

      mockQueries[hookName] = {
        data: { ...agingReport(rows, { skip: 90, total: 3 }), items: [] },
      };
      renderPanel(id, { pagination: pagination({ setSkip, skip: 90 }) });

      expect(setSkip).toHaveBeenCalledWith(0);
    });

    it("documento y contacto enlazan a su detalle con returnTo de la URL actual", () => {
      mockQueries[hookName] = { data: agingReport(rows) };
      renderPanel(id);

      const returnTo = `returnTo=${encodeURIComponent(LIST_HREF)}`;
      const prefix = type === "sale" ? "F" : "C";
      const path = type === "sale" ? "sales" : "purchases";

      expect(screen.getByRole("link", { name: `${prefix}-001` })).toHaveAttribute(
        "href",
        `/${path}/doc-1?${returnTo}`,
      );
      expect(screen.getByRole("link", { name: "Contacto 1" })).toHaveAttribute(
        "href",
        `/contacts/contacto-1?${returnTo}`,
      );
      // Sin contacto no hay enlace: «—».
      expect(within(screen.getByRole("row", { name: new RegExp(`${prefix}-002`) })).queryAllByRole("link")).toHaveLength(1);
    });

    it("la tabla trae fecha, días, tramo, total, pagado y pendiente en REF y Bs", () => {
      mockQueries[hookName] = { data: agingReport(rows) };
      renderPanel(id);

      const table = within(screen.getByRole("table"));

      expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
        type === "sale" ? "Venta" : "Compra",
        type === "sale" ? "Cliente" : "Proveedor",
        "Fecha",
        "Días",
        "Tramo",
        "Total",
        type === "sale" ? "Cobrado" : "Pagado",
        "Pendiente REF",
        "Pendiente Bs",
      ]);

      const cells = [...table.getAllByRole<HTMLTableRowElement>("row")[3]!.cells].map((cell) => cell.textContent);

      expect(cells.slice(2)).toEqual([
        "10/05/2026",
        "36",
        "Más de 30 días",
        "ref 45.00",
        "ref 5.00",
        "ref 40.00",
        "Bs. 1.600,00",
      ]);
    });

    it("el filtro de contacto usa el de la URL y avisa del elegido o de que se quita", async () => {
      const onFiltersChange = jest.fn();

      mockQueries[hookName] = { data: agingReport(rows) };
      renderPanel(id, { filters: { contactId: "c-1", currency: "ves" }, onFiltersChange });

      expect(hooks[hookName]).toHaveBeenLastCalledWith(expect.objectContaining({ contactId: "c-1" }));
      expect(screen.getByTestId("contact-filter")).toHaveTextContent("Contacto c-1");

      await userEvent.click(screen.getByRole("button", { name: "Elegir contacto" }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ contactId: "c-9" });

      await userEvent.click(screen.getByRole("button", { name: "Quitar contacto" }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ contactId: undefined });
    });

    it("vacío: sin tramos ni tabla, con su mensaje; el filtro de contacto sigue a mano", () => {
      mockQueries[hookName] = { data: agingReport([]) };
      const { container } = renderPanel(id);

      expect(screen.getByText(emptyTitle)).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Filtrar por antigüedad" })).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByTestId("contact-filter")).toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("cargando y error con reintento", async () => {
      mockQueries[hookName] = { isLoading: true };
      const loading = renderPanel(id);

      expect(screen.getByRole("status", { name: /Cargando/ })).toBeInTheDocument();
      loading.unmount();

      mockQueries[hookName] = { error: new Error("Sin conexión") };
      renderPanel(id);

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("diferencias de cierre de caja", () => {
    const rows = [closeRow(1, 5, 5), closeRow(2, -12.5, -7.5), closeRow(3, 0, -7.5), closeRow(4, 2.5, -5)];

    it("pide la moneda, el rango y la página; por defecto, Bs", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences", { pagination: pagination({ limit: 25, skip: 25 }) });

      expect(hooks.useCashCloseDifferencesReport).toHaveBeenLastCalledWith({
        currency: "ves",
        from: RANGE.from,
        limit: 25,
        skip: 25,
        to: RANGE.to,
      });

      const selector = within(screen.getByRole("group", { name: "Moneda" }));

      expect(selector.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
      expect(selector.getByRole("button", { name: "REF" })).toHaveAttribute("aria-pressed", "false");
    });

    it("el rango es opcional: sin él pide todos los cierres", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences", { dateFilters: {} });

      expect(hooks.useCashCloseDifferencesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: undefined, to: undefined }),
      );
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    it("cada diferencia lleva signo y la palabra sobrante, faltante o sin diferencia", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences");

      const body = within(screen.getByRole("table")).getAllByRole<HTMLTableRowElement>("row").slice(1);
      const differences = body.map((row) => row.querySelector("[data-difference]"));

      expect(differences.map((node) => node?.getAttribute("data-difference"))).toEqual([
        "sobrante",
        "faltante",
        "sin diferencia",
        "sobrante",
      ]);
      expect(differences.map((node) => node?.textContent)).toEqual([
        "+Bs. 5,00 sobrante",
        "−Bs. 12,50 faltante",
        "Bs. 0,00 sin diferencia",
        "+Bs. 2,50 sobrante",
      ]);
      expect(differences[0]).toHaveClass("text-primary");
      expect(differences[1]).toHaveClass("text-error");
      // Acumulado con signo, en la última columna.
      expect(body.map((row) => row.cells[6]?.textContent)).toEqual([
        "+Bs. 5,00",
        "−Bs. 7,50",
        "−Bs. 7,50",
        "−Bs. 5,00",
      ]);
    });

    it("la tabla trae fecha, caja, motivo legible, esperado y contado", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences");

      const table = within(screen.getByRole("table"));

      expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
        "Fecha de cierre",
        "Caja",
        "Motivo de cierre",
        "Esperado",
        "Contado",
        "Diferencia",
        "Acumulado",
      ]);

      const body = table.getAllByRole<HTMLTableRowElement>("row").slice(1);

      expect(body.map((row) => row.cells[2]?.textContent)).toEqual(["Manual", "Fin de día", "24 h", "—"]);
      expect(body.map((row) => row.cells[1]?.textContent)).toEqual([
        "Caja principal",
        "Caja principal",
        "Caja principal",
        "—",
      ]);
      // 22:00 UTC = 18:00 en Caracas.
      expect(body[0]?.cells[0]).toHaveTextContent(/01\/05\/2026.*18:00/);
      expect(body[1]?.cells[3]).toHaveTextContent("Bs. 100,00");
      expect(body[1]?.cells[4]).toHaveTextContent("Bs. 87,50");
    });

    it("totales por moneda, con su diferencia rotulada", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences");

      const totals = screen.getByTestId("cash-close-totals");

      expect(totals).toHaveTextContent("Total en Bs · 4 cierres");
      expect(totals).toHaveTextContent("−Bs. 5,00 faltante");
      expect(totals).toHaveTextContent("Total en REF · 1 cierre");
      expect(totals).toHaveTextContent("+ref 2.00 sobrante");
    });

    it("el gráfico es una sola línea del acumulado, en la moneda elegida", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      const { container } = renderPanel("cash-close-differences");

      const chart = screen.getByRole("img");

      expect(chart).toHaveAccessibleName(
        expect.stringMatching(/^Diferencias de cierre de caja: acumulado en Bs: 4 puntos/),
      );
      expect(chart).toHaveAccessibleName(expect.stringContaining("Bs. "));
      expect(chart).not.toHaveAccessibleName(expect.stringContaining("ref "));
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("en Bs el conmutador del gráfico cambia la misma moneda de la URL, no solo el dibujo", async () => {
      const onFiltersChange = jest.fn();

      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences", { onFiltersChange });

      const toggle = within(screen.getByRole("group", { name: "Moneda del gráfico" }));

      expect(toggle.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");

      await userEvent.click(toggle.getByRole("button", { name: "REF" }));

      expect(onFiltersChange).toHaveBeenLastCalledWith({ currency: "ref" });
      // Hasta que la URL cambie y lleguen los cierres en REF, el gráfico sigue en Bs.
      expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("acumulado en Bs"));
    });

    it("en REF pide REF y el gráfico no ofrece cambiar a Bs", async () => {
      const onFiltersChange = jest.fn();

      mockQueries.useCashCloseDifferencesReport = {
        data: closeReport(rows.map((row) => ({ ...row, currency: "ref" as const }))),
      };
      renderPanel("cash-close-differences", { filters: { currency: "ref" }, onFiltersChange });

      expect(hooks.useCashCloseDifferencesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ currency: "ref" }),
      );
      expect(screen.queryByRole("group", { name: "Moneda del gráfico" })).not.toBeInTheDocument();
      expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("acumulado en REF"));
      expect(within(screen.getByRole("table")).getAllByRole<HTMLTableRowElement>("row")[1]?.cells[5]).toHaveTextContent(
        "+ref 5.00 sobrante",
      );

      await userEvent.click(within(screen.getByRole("group", { name: "Moneda" })).getByRole("button", { name: "Bs" }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ currency: "ves" });
    });

    it("es de solo lectura: ningún botón de acción sobre la caja", () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport(rows) };
      renderPanel("cash-close-differences");

      const names = screen.getAllByRole("button").map((button) => button.textContent ?? "");

      expect(names.join(" | ")).not.toMatch(/ajustar|corregir|cerrar|abrir caja|anular|registrar|eliminar/i);
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    });

    it("vacío, cargando y error", async () => {
      mockQueries.useCashCloseDifferencesReport = { data: closeReport([]) };
      const empty = renderPanel("cash-close-differences");

      expect(screen.getByText("Sin cierres")).toBeInTheDocument();
      expect(empty.container.innerHTML).not.toMatch(/NaN|Infinity/);
      empty.unmount();

      mockQueries.useCashCloseDifferencesReport = { isLoading: true };
      const loading = renderPanel("cash-close-differences");

      expect(screen.getByRole("status", { name: /Cargando/ })).toBeInTheDocument();
      loading.unmount();

      mockQueries.useCashCloseDifferencesReport = { error: new Error("Sin conexión") };
      renderPanel("cash-close-differences");

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });
});
