/**
 * DET-06c · Configuración: las pestañas son el `Tabs` compartido con la activa
 * en `?tab=`, y las listas de Usuarios y Tasas llevan su página y su tamaño en
 * la URL con parámetros distintos (`usersPage`/`usersLimit`, `ratesPage`/`ratesLimit`).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ADMIN_CAN_SELL_OFF,
  apiData,
  buildSettings,
  createSettingsWrapper,
  installApi,
} from "./settingsApi.testUtils";

/** URL simulada: `useSearchParams` la sigue como hace Next tras un `history.replaceState`. */
const mockNavigation = {
  listeners: new Set<() => void>(),
  query: "",
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => "/settings",
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
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { SettingsListPage } from "./page";

const TOTAL_USERS = 25;
const TOTAL_RATES = 35;

function numbered(index: number) {
  return String(index + 1).padStart(3, "0");
}

/** Como el BFF: entrega solo la página pedida (`skip`/`limit`) y el total. */
function pageOf<T>(total: number, url: string, build: (index: number) => T) {
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  const limit = Number(params.get("limit") ?? 10);
  const skip = Number(params.get("skip") ?? 0);
  const count = Math.max(0, Math.min(limit, total - skip));

  return {
    items: Array.from({ length: count }, (_, offset) => build(skip + offset)),
    limit,
    skip,
    total,
  };
}

describe("SettingsListPage · pestañas y paginación en la URL (DET-06c)", () => {
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  let api: ReturnType<typeof installApi>;

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/settings?${query}` : "/settings");
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
    // jsdom no trae matchMedia; la tabla de tasas y la paginación lo consultan.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    api = installApi(({ url }) => {
      const path = url.split("?")[0];

      if (path === "/api/settings") {
        return apiData(buildSettings());
      }

      if (path === "/api/exchange-rates/current") {
        return apiData({ createdAt: "2026-10-07T12:00:00.000Z", id: "rate-now", rateVes: 50, source: "BCV" });
      }

      if (path === "/api/users") {
        return apiData(
          pageOf(TOTAL_USERS, url, (index) => ({
            email: `u${numbered(index)}@demo.test`,
            id: `user-${numbered(index)}`,
            isActive: true,
            name: `Usuario ${numbered(index)}`,
            role: "vendedor",
          })),
        );
      }

      if (path === "/api/exchange-rates") {
        return apiData(
          pageOf(TOTAL_RATES, url, (index) => ({
            createdAt: "2026-10-07T12:00:00.000Z",
            id: `rate-${numbered(index)}`,
            rateVes: 50 + index,
            source: `Fuente ${numbered(index)}`,
          })),
        );
      }

      if (path === "/api/settings/admin-can-sell") {
        return apiData(ADMIN_CAN_SELL_OFF);
      }

      return apiData({ items: [], limit: 10, skip: 0, total: 0 });
    });
  });

  afterEach(() => {
    window.history.replaceState = nativeReplaceState;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  /** Query de cada `GET` a esa ruta exacta, en orden. */
  function requestsTo(path: string) {
    return api.calls
      .filter((call) => call.method === "GET" && call.url.split("?")[0] === path)
      .map((call) => Object.fromEntries(new URLSearchParams(call.url.split("?")[1] ?? "")));
  }

  function lastRequestTo(path: string) {
    const requests = requestsTo(path);

    return requests[requests.length - 1];
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  function selectedTab() {
    return screen.getByRole("tab", { selected: true }).textContent;
  }

  function renderPage() {
    return render(<SettingsListPage />, { wrapper: createSettingsWrapper() });
  }

  it("sin `?tab=` abre General, con las mismas pestañas y en el mismo orden", async () => {
    renderPage();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "General / sistema",
      "Impuestos",
      "Precios",
      "Usuarios",
      "Tasas",
    ]);
    expect(selectedTab()).toBe("General / sistema");
    expect(await screen.findByText("Datos generales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(urlParams()).toEqual({});
  });

  it.each([
    ["impuestos", "Impuestos"],
    ["precios", "Precios"],
    ["usuarios", "Usuarios"],
    ["tasas", "Tasas"],
  ])("`?tab=%s` abre la pestaña %s", (tab, label) => {
    openAt(`tab=${tab}`);
    renderPage();

    expect(selectedTab()).toBe(label);
    expect(screen.queryByText("Datos generales")).not.toBeInTheDocument();
  });

  it("`?tab=usuarios` muestra la lista de usuarios y la acción «Nuevo usuario» de la cabecera", async () => {
    openAt("tab=usuarios");
    renderPage();

    expect(await screen.findByText("Usuario 001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo usuario" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });

  it("un `tab` desconocido abre la pestaña inicial, con sus acciones", async () => {
    openAt("tab=no-existe");
    renderPage();

    expect(selectedTab()).toBe("General / sistema");
    expect(await screen.findByText("Datos generales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
  });

  it("cambiar de pestaña escribe `tab` en la URL y volver a General lo quita", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(screen.getByRole("tab", { name: "Tasas" }));
    expect(urlParams()).toEqual({ tab: "tasas" });
    expect(await screen.findByText("Historial de tasas")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Usuarios" }));
    expect(urlParams()).toEqual({ tab: "usuarios" });
    expect(screen.getByRole("button", { name: "Nuevo usuario" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "General / sistema" }));
    expect(urlParams()).toEqual({});
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });

  it("recargar en una pestaña conserva la pestaña y su página", async () => {
    openAt("tab=usuarios&usersPage=2");
    renderPage();

    expect(selectedTab()).toBe("Usuarios");
    expect(await screen.findByText("Usuario 011")).toBeInTheDocument();
    expect(screen.queryByText("Usuario 001")).not.toBeInTheDocument();
    expect(requestsTo("/api/users")).toEqual([{ limit: "10", skip: "10" }]);
    expect(requestsTo("/api/exchange-rates")).toEqual([{ limit: "10", skip: "0" }]);
  });

  it("las páginas de Usuarios y Tasas son independientes y cada una escribe su parámetro", async () => {
    const user = userEvent.setup();

    openAt("tab=usuarios");
    renderPage();
    await screen.findByText("Usuario 001");

    await user.click(screen.getByRole("button", { name: "Pagina siguiente" }));

    expect(await screen.findByText("Usuario 011")).toBeInTheDocument();
    expect(urlParams()).toEqual({ tab: "usuarios", usersPage: "2" });
    expect(lastRequestTo("/api/users")).toEqual({ limit: "10", skip: "10" });
    expect(lastRequestTo("/api/exchange-rates")).toEqual({ limit: "10", skip: "0" });

    await user.click(screen.getByRole("tab", { name: "Tasas" }));
    await screen.findByText("Fuente 001");
    await user.click(screen.getByRole("button", { name: "Pagina siguiente" }));
    await screen.findByText("Fuente 011");
    await user.click(screen.getByRole("button", { name: "Pagina siguiente" }));

    expect(await screen.findByText("Fuente 021")).toBeInTheDocument();
    expect(urlParams()).toEqual({ ratesPage: "3", tab: "tasas", usersPage: "2" });
    expect(lastRequestTo("/api/exchange-rates")).toEqual({ limit: "10", skip: "20" });
    // La página de Usuarios no se movió al paginar Tasas.
    expect(lastRequestTo("/api/users")).toEqual({ limit: "10", skip: "10" });

    await user.click(screen.getByRole("tab", { name: "Usuarios" }));
    expect(await screen.findByText("Usuario 011")).toBeInTheDocument();
  });

  it("el tamaño de página de cada lista va en su parámetro y devuelve solo esa lista a la página 1", async () => {
    const user = userEvent.setup();

    openAt("tab=tasas&usersPage=2&ratesPage=2");
    renderPage();
    await screen.findByText("Fuente 011");

    await user.selectOptions(screen.getByLabelText("Resultados por pagina"), "25");

    await waitFor(() =>
      expect(urlParams()).toEqual({ ratesLimit: "25", tab: "tasas", usersPage: "2" }),
    );
    await waitFor(() =>
      expect(lastRequestTo("/api/exchange-rates")).toEqual({ limit: "25", skip: "0" }),
    );
    expect(lastRequestTo("/api/users")).toEqual({ limit: "10", skip: "10" });
  });

  it("`usersPage=9999` no rompe: cae a la última página de usuarios", async () => {
    openAt("tab=usuarios&usersPage=9999");
    renderPage();

    expect(await screen.findByText("Usuario 025")).toBeInTheDocument();
    expect(urlParams()).toEqual({ tab: "usuarios", usersPage: "3" });
    expect(lastRequestTo("/api/users")).toEqual({ limit: "10", skip: "20" });
    expect(within(screen.getByRole("tabpanel")).getByText("Usuarios del negocio")).toBeInTheDocument();
  });

  it("`ratesPage=9999` cae a la última página del historial sin tocar la de usuarios", async () => {
    openAt("tab=tasas&ratesPage=9999&usersPage=2");
    renderPage();

    expect(await screen.findByText("Fuente 035")).toBeInTheDocument();
    expect(urlParams()).toEqual({ ratesPage: "4", tab: "tasas", usersPage: "2" });
    expect(lastRequestTo("/api/users")).toEqual({ limit: "10", skip: "10" });
  });

  it("páginas y tamaños inválidos caen a su valor por defecto", async () => {
    openAt("tab=usuarios&usersPage=-3&usersLimit=abc&ratesPage=x&ratesLimit=0");
    renderPage();

    expect(await screen.findByText("Usuario 001")).toBeInTheDocument();
    expect(requestsTo("/api/users")).toEqual([{ limit: "10", skip: "0" }]);
    expect(requestsTo("/api/exchange-rates")).toEqual([{ limit: "10", skip: "0" }]);
  });
});
