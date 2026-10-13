/**
 * POS-H7 · `/reports` restaura el scroll al volver de un detalle. La pantalla
 * espera al aviso de «datos pintados» del reporte activo (su consulta terminó:
 * con filas, vacía, con error, sin permiso o con el panel caído) y solo entonces
 * aplica, una vez, la posición guardada para esa URL.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission } from "@/shared/auth/permissions";
import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

type MockQuery = {
  data: unknown;
  error: Error | null;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => void;
};

const mockRefetch = jest.fn();
const mockPending: MockQuery = { data: undefined, error: null, isFetching: true, isLoading: true, refetch: mockRefetch };
const mockEmpty: MockQuery = {
  data: { items: [], limit: 10, skip: 0, total: 0 },
  error: null,
  isFetching: false,
  isLoading: false,
  refetch: mockRefetch,
};
const mockWithRows: MockQuery = {
  ...mockEmpty,
  data: {
    items: [{ paidVes: 3600, saleDate: "2026-10-08", salesCount: 4, totalRef: 100, totalVes: 3600 }],
    limit: 10,
    skip: 0,
    total: 1,
  },
};
const mockFailed: MockQuery = {
  data: undefined,
  error: new Error("PT400: rango inválido"),
  isFetching: false,
  isLoading: false,
  refetch: mockRefetch,
};

/** Estado de la consulta de cada reporte; `"throw"` hace caer el render del panel. */
let mockDailySales: MockQuery | "throw" = mockPending;
let mockTopProducts: MockQuery = mockEmpty;
let mockStockAdjustments: MockQuery = mockPending;
let mockDeniedPermissions: Permission[] = [];
/** Viewport de la prueba: en móvil (390 px) coinciden las consultas `max-width`. */
let mockIsMobile = false;

jest.mock("../../dashboard/utils/businessDate", () => ({
  getBusinessTodayIsoDate: () => "2026-10-09",
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock("../../../shared/auth/usePermission", () => {
  const adminPermissions: Permission[] = jest
    .requireActual("../../../shared/auth/permissions")
    .getRolePermissions("admin");

  return {
    usePermission: () => {
      const permissions = adminPermissions.filter((permission) => !mockDeniedPermissions.includes(permission));

      return {
        can: (permission: Permission) => permissions.includes(permission),
        isLoading: false,
        permissions,
        role: "admin",
      };
    },
  };
});

jest.mock("../hooks/useReports", () => ({
  ...jest.requireActual("../hooks/useReports"),
  useDailySalesReport: () => {
    if (mockDailySales === "throw") {
      throw new Error("respuesta con forma inesperada");
    }

    return mockDailySales;
  },
  useTopProductsReport: () => mockTopProducts,
}));

jest.mock("../hooks/useInventoryReports", () => ({
  useDeadStockReport: () => mockPending,
  useStockAdjustmentsReport: () => mockStockAdjustments,
  useStockTurnoverReport: () => mockPending,
}));

jest.mock("./components/ReportsExportActions", () => ({
  ReportsExportActions: () => null,
}));

import { ReportsListPage } from "./page";

// URL canónica de `useUrlListState` (la que viaja en `returnTo`): el reporte por defecto no se escribe.
const DAILY_SALES_URL = "/reports?preset=last_month&page=2";
// Cambiar de reporte conserva el rango y vuelve a la página 1.
const TOP_PRODUCTS_URL = "/reports?report=top-products&preset=last_month";

function store(entries: [string, number][]) {
  window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify(entries));
}

function stored(): [string, number][] {
  return JSON.parse(window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY) ?? "[]");
}

function currentUrl() {
  return `${window.location.pathname}${window.location.search}`;
}

/** La pantalla dentro del `<main>` con scroll del `AppShell`. */
function Screen() {
  return (
    <main data-testid="main" style={{ overflowY: "auto" }}>
      <ReportsListPage />
    </main>
  );
}

const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

/**
 * Monta `/reports` en esa URL y registra cada posición que la restauración
 * aplica (también la del primer pintado, si la consulta ya venía resuelta).
 */
function renderPage(url: string) {
  window.history.replaceState(null, "", url);

  const applied: number[] = [];
  /** Secciones desplegadas en el instante de cada restauración: de ellas sale el alto. */
  const openSectionsWhenApplied: string[][] = [];
  let top = 0;

  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (next: number) => {
      top = next;
      applied.push(next);
      openSectionsWhenApplied.push(openSections());
    },
  });

  const view = render(<Screen />);
  const main = view.getByTestId("main");

  return {
    applied,
    openSectionsWhenApplied,
    /** Vuelve a pintar con el estado actual de las consultas, como al llegar la respuesta. */
    repaint: () => view.rerender(<Screen />),
    /** Scroll del usuario: no pasa por la restauración. */
    scrollTo: (next: number) => {
      top = next;
      fireEvent.scroll(main);
    },
    view,
  };
}

function catalogToggle() {
  return screen.getByRole("button", { name: /^Reporte: / });
}

function tableToggle() {
  return screen.getByRole("button", { name: /^Tabla de datos/ });
}

/** Secciones plegables de la pantalla que están desplegadas ahora mismo. */
function openSections() {
  return [
    ["catálogo", screen.queryByRole("button", { name: /^Reporte: / })] as const,
    ["tabla", screen.queryByRole("button", { name: /^Tabla de datos/ })] as const,
  ]
    .filter(([, toggle]) => toggle?.getAttribute("aria-expanded") === "true")
    .map(([name]) => name);
}

async function selectReport(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const toggle = screen.getByRole("button", { name: /^Reporte: / });

  if (toggle.getAttribute("aria-expanded") !== "true") {
    await user.click(toggle);
  }

  await user.click(
    within(screen.getByRole("navigation", { name: "Catálogo de reportes" })).getByRole("button", { name }),
  );
}

describe("ReportsListPage · scroll al volver de un detalle (POS-H7)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    mockIsMobile = false;
    mockDailySales = mockPending;
    mockTopProducts = mockEmpty;
    mockStockAdjustments = mockPending;
    mockDeniedPermissions = [];
    // Escritorio: el catálogo no se pliega al elegir.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: query.includes("max-width") === mockIsMobile,
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
    jest.restoreAllMocks();

    if (scrollTopDescriptor) {
      Object.defineProperty(Element.prototype, "scrollTop", scrollTopDescriptor);
    }

    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it("con la consulta pendiente no restaura; al resolverse aplica la posición guardada una sola vez", () => {
    store([[DAILY_SALES_URL, 480]]);

    const page = renderPage(DAILY_SALES_URL);

    expect(page.applied).toEqual([]);

    // Mientras carga tampoco se pisa lo guardado.
    page.scrollTo(0);
    expect(stored()).toEqual([[DAILY_SALES_URL, 480]]);

    mockDailySales = mockWithRows;
    page.repaint();

    expect(page.applied).toEqual([480]);

    // Una recarga posterior de la misma consulta no vuelve a mover el scroll.
    mockDailySales = { ...mockWithRows, isFetching: true, isLoading: true };
    page.repaint();
    mockDailySales = mockWithRows;
    page.repaint();

    expect(page.applied).toEqual([480]);
    expect(currentUrl()).toBe(DAILY_SALES_URL);
  });

  it.each<[string, () => void]>([
    ["error de la consulta", () => (mockDailySales = mockFailed)],
    ["respuesta vacía", () => (mockDailySales = mockEmpty)],
    [
      "panel caído al pintar",
      () => {
        // React registra en consola el error que captura el límite del panel.
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockDailySales = "throw";
      },
    ],
  ])("%s: también libera la señal y restaura", (_label, settle) => {
    store([[DAILY_SALES_URL, 480]]);

    const page = renderPage(DAILY_SALES_URL);

    expect(page.applied).toEqual([]);

    settle();
    page.repaint();

    expect(page.applied).toEqual([480]);
  });

  it("reporte sin permiso: el 403 del panel libera la señal sin pedir nada", () => {
    const url = "/reports?report=stock-adjustments";

    mockDeniedPermissions = ["inventory.view"];
    store([[url, 310]]);

    const page = renderPage(url);

    expect(page.applied).toEqual([310]);
  });

  it("un reporte de inventario espera a su propia consulta", () => {
    const url = "/reports?report=stock-adjustments&preset=last_month";

    store([[url, 310]]);

    const page = renderPage(url);

    expect(page.applied).toEqual([]);

    mockStockAdjustments = mockFailed;
    page.repaint();

    expect(page.applied).toEqual([310]);
  });

  it("en frío, sin posición guardada para la URL, no mueve el scroll", () => {
    store([["/reports?preset=last_month", 480]]);
    mockDailySales = mockWithRows;

    const page = renderPage(DAILY_SALES_URL);

    expect(page.applied).toEqual([]);
  });

  it("cambiar de reporte antes de que cargue no aplica la posición del anterior", async () => {
    const user = userEvent.setup();

    store([[DAILY_SALES_URL, 600]]);

    const page = renderPage(DAILY_SALES_URL);

    await selectReport(user, /Top productos/);

    expect(currentUrl()).toBe(TOP_PRODUCTS_URL);
    expect(page.applied).toEqual([]);

    // La respuesta tardía del reporte que ya no se muestra tampoco restaura nada.
    mockDailySales = mockWithRows;
    page.repaint();

    expect(page.applied).toEqual([]);
  });

  it("cambiar de reporte ya restaurado no salta a la posición guardada del nuevo", async () => {
    const user = userEvent.setup();

    store([
      [TOP_PRODUCTS_URL, 300],
      [DAILY_SALES_URL, 600],
    ]);
    mockDailySales = mockWithRows;

    const page = renderPage(DAILY_SALES_URL);

    expect(page.applied).toEqual([600]);

    await selectReport(user, /Top productos/);

    expect(currentUrl()).toBe(TOP_PRODUCTS_URL);
    expect(page.applied).toEqual([600]);
  });

  it("ida y vuelta: guarda la posición al salir al detalle y la recupera al volver", () => {
    mockDailySales = mockWithRows;

    const list = renderPage(DAILY_SALES_URL);

    list.scrollTo(725);
    list.view.unmount();

    expect(stored()).toEqual([[DAILY_SALES_URL, 725]]);

    // «Volver» del detalle abre la misma URL (`returnTo`) y la consulta vuelve a cargar.
    mockDailySales = mockPending;

    const back = renderPage(DAILY_SALES_URL);

    expect(back.applied).toEqual([]);

    mockDailySales = mockWithRows;
    back.repaint();

    expect(back.applied).toEqual([725]);
  });

  // POS-F6 (F2 de qa-final): lo plegado y desplegado decide el alto de la página. Si al
  // volver no está como se dejó, la posición guardada cae en otro sitio o no existe.
  describe("las secciones plegables vuelven como se dejaron (POS-F6)", () => {
    it("móvil: «Tabla de datos» nace plegada; desplegada, vuelve desplegada y se restaura sobre ella", async () => {
      const user = userEvent.setup();

      mockIsMobile = true;
      mockDailySales = mockWithRows;

      const list = renderPage(DAILY_SALES_URL);

      expect(tableToggle()).toHaveAttribute("aria-expanded", "false");

      await user.click(tableToggle());
      list.scrollTo(1772);
      list.view.unmount();

      // «Volver» del detalle: la consulta vuelve a cargar.
      mockDailySales = mockPending;

      const back = renderPage(DAILY_SALES_URL);

      mockDailySales = mockWithRows;
      back.repaint();

      expect(tableToggle()).toHaveAttribute("aria-expanded", "true");
      expect(back.applied).toEqual([1772]);
      expect(back.openSectionsWhenApplied).toEqual([["tabla"]]);
    });

    // GQ-02: en escritorio también nace plegada (plan §4.9 REP-04 y §6.10).
    it("escritorio: «Tabla de datos» nace plegada; desplegada y vuelta a plegar a mano, vuelve plegada", async () => {
      const user = userEvent.setup();

      mockDailySales = mockWithRows;

      const list = renderPage(DAILY_SALES_URL);

      expect(tableToggle()).toHaveAttribute("aria-expanded", "false");

      await user.click(tableToggle());
      expect(tableToggle()).toHaveAttribute("aria-expanded", "true");

      await user.click(tableToggle());
      list.scrollTo(240);
      list.view.unmount();

      const back = renderPage(DAILY_SALES_URL);

      expect(tableToggle()).toHaveAttribute("aria-expanded", "false");
      expect(back.applied).toEqual([240]);
      expect(back.openSectionsWhenApplied).toEqual([[]]);
    });

    it("escritorio: «Tabla de datos» desplegada a mano vuelve desplegada", async () => {
      const user = userEvent.setup();

      mockDailySales = mockWithRows;

      const list = renderPage(DAILY_SALES_URL);

      await user.click(tableToggle());
      list.scrollTo(1772);
      list.view.unmount();

      const back = renderPage(DAILY_SALES_URL);

      expect(tableToggle()).toHaveAttribute("aria-expanded", "true");
      expect(back.applied).toEqual([1772]);
      expect(back.openSectionsWhenApplied).toEqual([["tabla"]]);
    });

    it("escritorio: tras cambiar de reporte por el catálogo, el catálogo vuelve desplegado y se restaura sobre él", async () => {
      const user = userEvent.setup();

      mockDailySales = mockWithRows;

      const list = renderPage(DAILY_SALES_URL);

      expect(catalogToggle()).toHaveAttribute("aria-expanded", "false");

      await selectReport(user, /Top productos/);

      expect(currentUrl()).toBe(TOP_PRODUCTS_URL);
      expect(catalogToggle()).toHaveAttribute("aria-expanded", "true");

      list.scrollTo(2134);
      list.view.unmount();

      const back = renderPage(TOP_PRODUCTS_URL);

      expect(catalogToggle()).toHaveAttribute("aria-expanded", "true");
      expect(back.applied).toEqual([2134]);
      expect(back.openSectionsWhenApplied).toEqual([["catálogo"]]);
    });

    it("móvil: elegir un reporte pliega el catálogo y así vuelve", async () => {
      const user = userEvent.setup();

      mockIsMobile = true;
      mockDailySales = mockWithRows;

      const list = renderPage(DAILY_SALES_URL);

      await selectReport(user, /Top productos/);

      expect(catalogToggle()).toHaveAttribute("aria-expanded", "false");

      list.scrollTo(300);
      list.view.unmount();

      const back = renderPage(TOP_PRODUCTS_URL);

      expect(catalogToggle()).toHaveAttribute("aria-expanded", "false");
      expect(back.applied).toEqual([300]);
    });

    it("sin almacenamiento de sesión las secciones siguen plegándose y desplegándose", async () => {
      const user = userEvent.setup();

      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("almacenamiento bloqueado");
      });
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("almacenamiento bloqueado");
      });
      mockDailySales = mockWithRows;

      renderPage(DAILY_SALES_URL);

      await user.click(tableToggle());
      expect(tableToggle()).toHaveAttribute("aria-expanded", "true");

      await user.click(tableToggle());
      expect(tableToggle()).toHaveAttribute("aria-expanded", "false");

      await user.click(catalogToggle());
      expect(catalogToggle()).toHaveAttribute("aria-expanded", "true");
    });
  });
});
