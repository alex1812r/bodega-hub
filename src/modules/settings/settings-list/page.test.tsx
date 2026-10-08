/**
 * PRO-09 / D20 · Configuración: pestañas "Impuestos" y "Precios", sin campos
 * `type="number"` y sin IVA tecleable. "Umbral bajo inventario" y "Tasa manual"
 * pasan a `NumberInput` y envían lo mismo que antes.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiData,
  buildRate,
  buildSettings,
  createSettingsWrapper,
  installApi,
} from "./settingsApi.testUtils";

const mockPermissions = new Set<string>();

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.has(permission),
    isLoading: false,
    role: "admin",
  }),
}));

import { SettingsListPage } from "./page";

type UserSession = ReturnType<typeof userEvent.setup>;

const emptyPage = { items: [], limit: 10, skip: 0, total: 0 };

function installServer() {
  let settings = buildSettings();

  return installApi(({ body, method, url }) => {
    if (url === "/api/settings") {
      if (method === "PATCH") {
        settings = { ...settings, ...(body as Partial<typeof settings>) };
      }

      return apiData(settings);
    }

    if (url.startsWith("/api/tax-rates")) {
      return apiData({
        items: [buildRate({ code: "general", isDefault: true, label: "General", pct: 16 })],
      });
    }

    if (url.startsWith("/api/exchange-rates/current")) {
      return apiData({ createdAt: "2026-10-07T12:00:00.000Z", id: "rate-1", rateVes: 50, source: "BCV" });
    }

    if (url.startsWith("/api/exchange-rates") && method === "POST") {
      return apiData({ createdAt: "2026-10-07T12:00:00.000Z", id: "rate-2", ...(body as object) }, 201);
    }

    return apiData(emptyPage);
  });
}

function renderPage() {
  const user = userEvent.setup({ delay: null });

  render(<SettingsListPage />, { wrapper: createSettingsWrapper() });

  return user;
}

async function openTab(user: UserSession, name: string) {
  await user.click(screen.getByRole("tab", { name }));
}

async function thresholdField() {
  const field = screen.getByLabelText("Umbral bajo inventario");

  await waitFor(() => expect(field).toHaveValue("5"));

  return field;
}

function numericInputs() {
  return document.querySelectorAll('input[type="number"]');
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // jsdom no trae matchMedia y la tabla del historial de tasas lo consulta.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: jest.fn(),
      matches: false,
      media: query,
      removeEventListener: jest.fn(),
    }),
  });
  mockPermissions.clear();
  mockPermissions.add("users.manage");
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("SettingsListPage · Impuestos, Precios y D20 (PRO-09)", () => {
  it("ofrece las pestañas Impuestos y Precios", () => {
    installServer();
    renderPage();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "General / sistema",
      "Impuestos",
      "Precios",
      "Usuarios",
      "Tasas",
    ]);
  });

  it("General ya no tiene el IVA por defecto tecleable ni ningún type=number", async () => {
    installServer();
    renderPage();

    const threshold = await thresholdField();

    expect(screen.queryByLabelText(/IVA por defecto/)).not.toBeInTheDocument();
    expect(numericInputs()).toHaveLength(0);
    expect(threshold).toHaveAttribute("type", "text");
    expect(threshold).toHaveAttribute("inputmode", "numeric");
  });

  it("Umbral bajo inventario envía el mismo entero que antes y ya no envía defaultTaxRate", async () => {
    const api = installServer();
    const user = renderPage();
    const threshold = await thresholdField();

    await user.clear(threshold);
    await user.type(threshold, "8");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: {
        businessName: "Bodega de prueba",
        enabledPaymentMethods: ["efectivo_ves", "pago_movil"],
        invoicePrefix: "V",
        lowStockThreshold: 8,
      },
      method: "PATCH",
      url: "/api/settings",
    });
  });

  it("Umbral bajo inventario con decimales avisa y no se envía", async () => {
    const api = installServer();
    const user = renderPage();
    const threshold = await thresholdField();

    await user.clear(threshold);
    await user.type(threshold, "2,5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("Debe ser un número entero.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("Tasa manual es un NumberInput y envía el mismo número con coma o con punto", async () => {
    const api = installServer();
    const user = renderPage();

    await thresholdField();
    await openTab(user, "Tasas");

    const rate = screen.getByLabelText("Tasa manual (historial)");

    expect(numericInputs()).toHaveLength(0);
    expect(rate).toHaveAttribute("type", "text");
    expect(rate).toHaveAttribute("inputmode", "decimal");
    expect(rate).toBeRequired();

    await user.type(rate, "36,55");
    await user.click(screen.getByRole("button", { name: "Registrar en historial" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { rateVes: 36.55, source: "Manual" },
      method: "POST",
      url: "/api/exchange-rates",
    });
  });

  it("Impuestos: la alícuota por defecto se elige con chips, sin campos numéricos", async () => {
    installServer();

    const user = renderPage();

    await thresholdField();
    await openTab(user, "Impuestos");

    expect(
      await screen.findByRole("button", {
        name: "Alícuota por defecto para categorías nuevas: IVA 16 %",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Añadir alícuota" })).toBeInTheDocument();
    expect(numericInputs()).toHaveLength(0);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Precios: muestra el semáforo y los chips con sus acciones de edición", async () => {
    installServer();

    const user = renderPage();

    await thresholdField();
    await openTab(user, "Precios");

    expect(await screen.findByLabelText("Rojo por debajo de (%)")).toHaveValue("15");
    expect(screen.getByRole("button", { name: "Guardar precios" })).toBeInTheDocument();
    expect(numericInputs()).toHaveLength(0);
  });

  it("sin users.manage, Impuestos y Precios no ofrecen acciones de edición", async () => {
    mockPermissions.clear();
    installServer();

    const user = renderPage();

    await thresholdField();
    await openTab(user, "Impuestos");

    expect(await screen.findByRole("list", { name: "Alícuotas de IVA" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir alícuota" })).not.toBeInTheDocument();

    await openTab(user, "Precios");

    expect(await screen.findByLabelText("Rojo por debajo de (%)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar precios" })).not.toBeInTheDocument();
  });
});
