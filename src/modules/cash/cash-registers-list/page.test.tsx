/**
 * DET-06b · cajas: la lista no tiene búsqueda, filtros ni paginación (sin estado
 * que conservar en la URL); sus enlaces al detalle son enlaces reales con la
 * ruta de la lista en `returnTo`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/cash/registers",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import type { CashRegister } from "../types";
import { CashRegistersListPage } from "./page";

function register(id: string): CashRegister {
  return {
    assignedUserId: null,
    assignedUserName: null,
    createdAt: "2026-01-15T12:00:00.000Z",
    id,
    isActive: true,
    name: `Caja ${id}`,
    storeId: "store-1",
    updatedAt: "2026-01-15T12:00:00.000Z",
  };
}

describe("CashRegistersListPage · enlaces al detalle (DET-06b)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/cash/registers");
    // jsdom no trae matchMedia; la tabla de escritorio es la que tiene el menú de fila.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url).split("?")[0];
      const data =
        path === "/api/cash/registers"
          ? [register("001"), register("002")]
          : path === "/api/users"
            ? { items: [], limit: 100, skip: 0, total: 0 }
            : [];

      return {
        headers: { get: () => "application/json" },
        json: async () => ({ data }),
        ok: true,
        status: 200,
      };
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <CashRegistersListPage />
      </QueryClientProvider>,
    );
  }

  it("el nombre de la caja es un enlace al detalle con la lista en returnTo", async () => {
    renderPage();

    const link = await screen.findByRole("link", { name: "Caja 001" });

    expect(link).toHaveAttribute("href", "/cash/registers/001?returnTo=%2Fcash%2Fregisters");
  });

  it("«Ver detalle» del menú de fila lleva el mismo returnTo", async () => {
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Acciones de Caja 002" }));

    expect(await screen.findByRole("menuitem", { name: "Ver detalle" })).toHaveAttribute(
      "href",
      "/cash/registers/002?returnTo=%2Fcash%2Fregisters",
    );
  });

  it("parámetros que la pantalla no usa (`page=9999`, `sort`) no la rompen ni se cuelan en el retorno", async () => {
    window.history.replaceState(null, "", "/cash/registers?page=9999&sort=cualquiera");
    renderPage();

    expect(await screen.findByRole("link", { name: "Caja 001" })).toHaveAttribute(
      "href",
      "/cash/registers/001?returnTo=%2Fcash%2Fregisters",
    );
    expect(screen.getAllByText("Caja 002").length).toBeGreaterThan(0);
  });
});

/**
 * POS-F5 (qa-final F1): con «El administrador puede vender» encendido el admin no
 * aparecía en el selector (solo listaba `role === "vendedor"`). Se lista a quien
 * tiene `cash.operate` efectivo y está activo.
 */
describe("CashRegistersListPage · a quién se puede asignar una caja (POS-F5)", () => {
  const originalMatchMedia = window.matchMedia;
  let registers: Array<ReturnType<typeof register>>;
  let patches: Array<{ body: unknown; url: string }>;

  const users = [
    { id: "seller", isActive: true, name: "Vendedora Activa", role: "vendedor" },
    { id: "seller-off", isActive: false, name: "Vendedor Inactivo", role: "vendedor" },
    {
      deniedPermissions: ["cash.operate"],
      id: "seller-denied",
      isActive: true,
      name: "Vendedor Sin Caja",
      role: "vendedor",
    },
    {
      grantedPermissions: ["sales.create", "cash.operate"],
      id: "admin-sells",
      isActive: true,
      name: "Admin Que Vende",
      role: "admin",
    },
    { id: "admin-plain", isActive: true, name: "Admin Sin Venta", role: "admin" },
    { id: "accountant", isActive: true, name: "Contadora", role: "contador" },
    {
      grantedPermissions: ["cash.operate"],
      id: "warehouse-cash",
      isActive: true,
      name: "Almacén Con Caja",
      role: "almacen",
    },
  ];

  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/cash/registers");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    registers = [register("001")];
    patches = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      let data: unknown = [];

      if (init?.method === "PATCH") {
        patches.push({ body: JSON.parse(String(init.body)), url: path });
        data = registers[0];
      } else if (path === "/api/cash/registers") {
        data = registers;
      } else if (path === "/api/users") {
        data = { items: users, limit: 100, skip: 0, total: users.length };
      }

      return {
        headers: { get: () => "application/json" },
        json: async () => ({ data }),
        ok: true,
        status: 200,
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CashRegistersListPage />
      </QueryClientProvider>,
    );
  }

  async function assignmentSelect() {
    const [select] = await screen.findAllByRole("combobox", { name: "Asignar Caja 001" });

    return select as HTMLSelectElement;
  }

  function optionLabels(select: HTMLSelectElement) {
    return Array.from(select.options).map((option) => option.textContent);
  }

  it("lista a los usuarios activos con cash.operate: vendedores, el admin que vende y permisos concedidos", async () => {
    renderPage();

    const select = await assignmentSelect();

    await waitFor(() =>
      expect(optionLabels(select)).toEqual([
        "Sin asignar",
        "Vendedora Activa",
        "Admin Que Vende",
        "Almacén Con Caja",
      ]),
    );
  });

  it("el administrador que vende se puede asignar una caja", async () => {
    const user = userEvent.setup();

    renderPage();

    const select = await assignmentSelect();

    await waitFor(() => expect(optionLabels(select)).toContain("Admin Que Vende"));
    await user.selectOptions(select, "admin-sells");

    await waitFor(() =>
      expect(patches).toEqual([
        {
          body: { assignedUserId: "admin-sells", assignedUserName: "Admin Que Vende" },
          url: "/api/cash/registers/001",
        },
      ]),
    );
  });

  it("con el interruptor apagado la caja sigue mostrando al administrador asignado", async () => {
    registers = [
      { ...register("001"), assignedUserId: "admin-plain", assignedUserName: "Admin Sin Venta" },
    ];
    renderPage();

    const select = await assignmentSelect();

    await waitFor(() => expect(optionLabels(select)).toContain("Vendedora Activa"));
    expect(select.value).toBe("admin-plain");
    expect(select.selectedOptions[0]).toHaveTextContent("Admin Sin Venta");
    expect(optionLabels(select).filter((label) => label?.includes("Admin Sin Venta"))).toHaveLength(1);
  });
});
