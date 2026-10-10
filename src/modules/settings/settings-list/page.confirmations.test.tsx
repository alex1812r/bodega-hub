/**
 * CNF-11 · Configuración: los métodos de pago confirman con lo que cambia, el
 * umbral de faltante del cierre de caja se guarda con el formulario y los
 * usuarios ya no se guardan al elegir en el desplegable.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ADMIN_CAN_SELL_OFF,
  apiData,
  apiError,
  buildRate,
  buildSettings,
  createSettingsWrapper,
  installApi,
} from "./settingsApi.testUtils";

const mockNavigation = { query: "" };

jest.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNavigation.query),
}));

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { SettingsListPage } from "./page";

const UNAVAILABLE_MESSAGE =
  "Esta base aún no admite el umbral de faltante al cerrar caja. No se guardó ningún cambio.";
const THRESHOLD_LABEL = "Avisar al cerrar caja si el faltante supera (Bs)";

type ServerOptions = { cashCloseDiffAlertVes?: number; rejectWith?: { message: string; status: number } };

function installServer({ cashCloseDiffAlertVes = 0, rejectWith }: ServerOptions = {}) {
  let settings = { ...buildSettings(), cashCloseDiffAlertVes };

  return installApi(({ body, method, url }) => {
    const path = url.split("?")[0];

    if (path === "/api/settings") {
      if (method === "PATCH") {
        if (rejectWith) {
          return apiError(rejectWith.message, rejectWith.status);
        }

        settings = { ...settings, ...(body as Partial<typeof settings>) };
      }

      return apiData(settings);
    }

    if (path === "/api/tax-rates") {
      return apiData({ items: [buildRate({ code: "general", isDefault: true, pct: 16 })] });
    }

    if (path === "/api/exchange-rates/current") {
      return apiData({ createdAt: "2026-10-07T12:00:00.000Z", id: "rate-1", rateVes: 50, source: "BCV" });
    }

    if (path === "/api/users") {
      return apiData({
        items: [
          { email: "ana@demo.test", id: "user-ana", isActive: true, name: "Ana Pérez", role: "vendedor" },
        ],
        limit: 10,
        skip: 0,
        total: 1,
      });
    }

    if (url.split("?")[0] === "/api/settings/admin-can-sell") {
      return apiData(ADMIN_CAN_SELL_OFF);
    }

    return apiData({ items: [], limit: 10, skip: 0, total: 0 });
  });
}

function renderPage() {
  const user = userEvent.setup({ delay: null });

  render(<SettingsListPage />, { wrapper: createSettingsWrapper() });

  return user;
}

async function loadedThreshold(value: string) {
  const field = screen.getByLabelText(THRESHOLD_LABEL);

  // El formulario parte de «0»: se espera a que carguen los ajustes, no solo al valor.
  await waitFor(() =>
    expect(screen.getByLabelText("Nombre del negocio")).toHaveValue("Bodega de prueba"),
  );
  expect(field).toHaveValue(value);

  return field;
}

function saveButton() {
  return screen.getByRole("button", { name: "Guardar" });
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  mockNavigation.query = "";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: jest.fn(),
      matches: false,
      media: query,
      removeEventListener: jest.fn(),
    }),
  });
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("SettingsListPage · umbral de faltante al cerrar caja (CNF-11)", () => {
  it("muestra el valor guardado en un NumberInput con su ayuda", async () => {
    installServer({ cashCloseDiffAlertVes: 12.5 });
    renderPage();

    const field = await loadedThreshold("12.5");

    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expect(field).toHaveAccessibleDescription("0 = avisa ante cualquier faltante");
    expect(saveButton()).toBeDisabled();
  });

  it("se guarda con el formulario, sin confirmación, como monto en Bs con dos decimales", async () => {
    const api = installServer();
    const user = renderPage();
    const field = await loadedThreshold("0");

    await user.clear(field);
    await user.type(field, "25,5");
    await user.click(saveButton());

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.writes()[0]).toEqual({
      body: {
        businessName: "Bodega de prueba",
        cashCloseDiffAlertVes: 25.5,
        enabledPaymentMethods: ["efectivo_ves", "pago_movil"],
        invoicePrefix: "V",
        lowStockThreshold: 5,
      },
      method: "PATCH",
      url: "/api/settings",
    });
    expect(await screen.findByText(/^Ajustes guardados/)).toBeInTheDocument();
  });

  it("si no cambió, el umbral no viaja en el guardado", async () => {
    const api = installServer({ cashCloseDiffAlertVes: 10 });
    const user = renderPage();

    await loadedThreshold("10");
    await user.type(screen.getByLabelText("Nombre del negocio"), " 2");
    await user.click(saveButton());

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).not.toHaveProperty("cashCloseDiffAlertVes");
  });

  it.each([
    [409, UNAVAILABLE_MESSAGE],
    [400, "El umbral de faltante al cerrar caja debe ser un monto en Bs igual o mayor que 0."],
  ])("un %i del servidor se muestra tal cual", async (status, message) => {
    installServer({ rejectWith: { message, status } });

    const user = renderPage();
    const field = await loadedThreshold("0");

    await user.clear(field);
    await user.type(field, "30");
    await user.click(saveButton());

    // Bajo el formulario, con el texto del servidor sin retocar.
    expect(await screen.findByText(message)).toHaveAttribute("role", "alert");
    expect(field).toHaveValue("30");
  });
});

describe("SettingsListPage · métodos de pago habilitados (CNF-11)", () => {
  async function togglePagoMovil(user: ReturnType<typeof userEvent.setup>) {
    await loadedThreshold("0");
    await user.click(screen.getByRole("checkbox", { name: "Pago movil" }));
  }

  it("deshabilitar un método pide confirmación con lo que cambia y su consecuencia", async () => {
    const api = installServer();
    const user = renderPage();

    await togglePagoMovil(user);
    await user.click(screen.getByRole("checkbox", { name: "Transferencia" }));
    await user.click(saveButton());

    const dialog = await screen.findByRole("dialog", { name: "¿Guardar los métodos de pago?" });
    const effects = within(dialog)
      .getAllByRole("listitem")
      .filter((item) => item.hasAttribute("data-tone"));

    expect(effects).toHaveLength(2);
    expect(effects[0]).toHaveTextContent("Pago movil");
    expect(effects[0]).toHaveTextContent("Habilitado");
    expect(effects[0]).toHaveTextContent("Deshabilitado");
    expect(effects[0]).toHaveAttribute("data-tone", "warning");
    expect(effects[1]).toHaveTextContent("Transferencia");
    expect(effects[1]).toHaveAttribute("data-tone", "positive");
    expect(dialog).toHaveTextContent(
      "Los métodos que se deshabilitan dejan de ofrecerse al cobrar en el POS y al registrar pagos",
    );
    expect(dialog).toHaveTextContent("Los pagos ya registrados no cambian.");
    expect(dialog).not.toHaveTextContent("También se guardan los demás cambios del formulario.");
    expect(api.writes()).toHaveLength(0);
  });

  it("cancelar no guarda y conserva lo marcado en el formulario", async () => {
    const api = installServer();
    const user = renderPage();

    await togglePagoMovil(user);
    await user.click(saveButton());
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: "Pago movil" })).not.toBeChecked();
    expect(saveButton()).toBeEnabled();
  });

  it("confirmar guarda UNA vez aunque haya doble clic, junto con el resto del formulario", async () => {
    const api = installServer();
    const user = renderPage();

    await togglePagoMovil(user);
    await user.type(screen.getByLabelText("Nombre del negocio"), " 2");
    await user.click(saveButton());

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("También se guardan los demás cambios del formulario.");

    await user.dblClick(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      {
        body: {
          businessName: "Bodega de prueba 2",
          enabledPaymentMethods: ["efectivo_ves"],
          invoicePrefix: "V",
          lowStockThreshold: 5,
        },
        method: "PATCH",
        url: "/api/settings",
      },
    ]);
  });

  it("si el servidor rechaza, su mensaje se muestra dentro del diálogo", async () => {
    installServer({ rejectWith: { message: "Debe quedar al menos un metodo de pago.", status: 400 } });

    const user = renderPage();

    await togglePagoMovil(user);
    await user.click(saveButton());

    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Debe quedar al menos un metodo de pago.",
    );
  });

  it("sin cambios en los métodos, guardar no pide confirmación", async () => {
    const api = installServer();
    const user = renderPage();

    await loadedThreshold("0");
    await user.type(screen.getByLabelText("Prefijo de factura"), "X");
    await user.click(saveButton());

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("el último método habilitado sigue sin poder desmarcarse", async () => {
    installServer();

    const user = renderPage();

    await togglePagoMovil(user);

    expect(screen.getByRole("checkbox", { name: "Efectivo VES" })).toBeDisabled();
  });
});

describe("SettingsListPage · usuarios (CNF-11)", () => {
  it("elegir otro rol en la pestaña Usuarios no escribe nada hasta Guardar", async () => {
    mockNavigation.query = "tab=usuarios";

    const api = installServer();
    const user = renderPage();
    const role = await screen.findByLabelText("Rol");

    await user.selectOptions(role, "admin");

    expect(screen.getByRole("button", { name: "Guardar cambios de Ana Pérez" })).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("un lector de códigos con la confirmación del cambio de rol abierta no guarda nada (CNF-F7 · CAOS-01)", async () => {
    mockNavigation.query = "tab=usuarios";

    const api = installServer();
    const user = renderPage();

    await user.selectOptions(await screen.findByLabelText("Rol"), "admin");
    await user.click(screen.getByRole("button", { name: "Guardar cambios de Ana Pérez" }));

    const dialog = await screen.findByRole("dialog", { name: "¿Guardar los cambios de Ana Pérez?" });

    await user.keyboard("7591234567895{Enter}");
    await user.keyboard("HER-TAL-001{Enter}");

    expect(api.writes()).toHaveLength(0);
    expect(dialog).toBeInTheDocument();
  });
});
