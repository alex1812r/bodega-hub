/**
 * POS-02 · Configuración → «El administrador puede vender»: el interruptor no
 * guarda al pulsarlo, confirma con el antes → después y los administradores
 * afectados; y el caos 7.8 en la UI (cerrar la caja propia sin `cash.operate`).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiData, apiError, createSettingsWrapper, installApi } from "../settingsApi.testUtils";

const mockPermissions = new Set<string>();

jest.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.has(permission),
    isLoading: false,
    role: "admin",
  }),
}));

import { ADMIN_CAN_SELL_LABEL, AdminCanSellCard } from "./AdminCanSellCard";

type Admin = { canSell: boolean; id: string; name: string };

const ana: Admin = { canSell: false, id: "admin-ana", name: "Ana Pérez" };
const luis: Admin = { canSell: false, id: "admin-luis", name: "Luis Gómez" };

const openSession = {
  id: "session-1",
  openedAt: "2026-10-09T12:00:00.000Z",
  openingRef: 0,
  openingVes: 100,
  register: {
    assignedUserId: ana.id,
    createdAt: "2026-10-01T12:00:00.000Z",
    id: "register-1",
    isActive: true,
    name: "Caja principal",
    storeId: "store-1",
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
  registerId: "register-1",
  status: "open",
};

type ServerOptions = {
  admins?: Admin[];
  failLoad?: boolean;
  /** La caja abierta de quien tiene la sesión (`GET /api/cash/session`). */
  ownSession?: typeof openSession | null;
  rejectWith?: { message: string; status: number };
  /** Cajas abiertas de la tienda (`GET /api/cash/session/open`). */
  storeSessions?: Array<typeof openSession>;
  /** Mantiene el PUT sin responder hasta que el test lo libere. */
  waitFor?: Promise<void>;
};

function installServer({
  admins = [ana, luis],
  failLoad = false,
  ownSession = null,
  rejectWith,
  storeSessions = [],
  waitFor: gate,
}: ServerOptions = {}) {
  let current = admins;
  let own = ownSession;
  const state = () => ({
    admins: current,
    enabled: current.length > 0 && current.every((admin) => admin.canSell),
  });

  return installApi(async ({ body, method, url }) => {
    const path = url.split("?")[0];

    if (path === "/api/settings/admin-can-sell") {
      if (method === "PUT") {
        await gate;

        if (rejectWith) {
          return apiError(rejectWith.message, rejectWith.status);
        }

        const { enabled } = body as { enabled: boolean };

        current = current.map((admin) => ({ ...admin, canSell: enabled }));
      } else if (failLoad) {
        return apiError("No tienes permiso para realizar esta accion.", 403);
      }

      return apiData(state());
    }

    if (path === "/api/cash/session/open") {
      return apiData(storeSessions);
    }

    if (path === "/api/cash/session") {
      return apiData(own);
    }

    if (path === "/api/cash/movements") {
      return apiData({ accountVes: 0, items: [], theoretical: { ref: 0, ves: 100 } });
    }

    if (path === "/api/settings/cash-close") {
      return apiData({ cashCloseDiffAlertVes: 0 });
    }

    if (path === "/api/cash/session/close" && method === "POST") {
      own = null;

      return apiData({ ...openSession, status: "closed" });
    }

    return apiError(`Sin respuesta para ${url}`, 404);
  });
}

function renderCard() {
  const user = userEvent.setup({ delay: null });

  render(<AdminCanSellCard />, { wrapper: createSettingsWrapper() });

  return user;
}

const findSwitch = () => screen.findByRole("switch", { name: ADMIN_CAN_SELL_LABEL });

function effectRow(dialog: HTMLElement, label: string) {
  const row = within(dialog).getByText(label).closest("li");

  if (!row) {
    throw new Error(`Sin fila de efecto para ${label}`);
  }

  return row;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  mockPermissions.clear();
  ["users.manage", "settings.view", "cash.view", "cash.manage", "cash.operate"].forEach(
    (permission) => mockPermissions.add(permission),
  );
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: jest.fn(),
      addListener: jest.fn(),
      matches: false,
      media: query,
      removeEventListener: jest.fn(),
      removeListener: jest.fn(),
    }),
  });
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("AdminCanSellCard (POS-02)", () => {
  it("muestra el interruptor apagado y pulsarlo NO guarda: abre la confirmación", async () => {
    const api = installServer();
    const user = renderCard();
    const toggle = await findSwitch();

    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    const dialog = await screen.findByRole("dialog", {
      name: "¿Permitir que el administrador venda?",
    });

    expect(effectRow(dialog, "Vender en el POS")).toHaveTextContent(/No.*Sí/);
    expect(effectRow(dialog, "Operar caja")).toHaveTextContent(/No.*Sí/);
    expect(
      within(within(dialog).getByRole("list", { name: "Administradores afectados" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ana Pérez", "Luis Gómez"]);
    expect(dialog).toHaveTextContent("Afecta a 2 administradores:");
    expect(api.writes()).toHaveLength(0);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("cancelar no llama al servidor y deja el interruptor como estaba", async () => {
    const api = installServer();
    const user = renderCard();

    await user.click(await findSwitch());
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(0);
    expect(await findSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("confirmar llama UNA vez aunque haya doble clic y enciende el interruptor", async () => {
    const api = installServer();
    const user = renderCard();

    await user.click(await findSwitch());
    await user.dblClick(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Permitir vender" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      { body: { enabled: true }, method: "PUT", url: "/api/settings/admin-can-sell" },
    ]);
    expect(await findSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      await screen.findByText("Los administradores ya pueden vender y operar caja"),
    ).toBeInTheDocument();
  });

  it("mientras guarda, la confirmación queda bloqueada (isPending)", async () => {
    let release: () => void = () => undefined;
    const api = installServer({
      waitFor: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const user = renderCard();

    await user.click(await findSwitch());

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Permitir vender" });

    await user.click(confirm);

    await waitFor(() => expect(confirm).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await user.click(confirm);
    expect(api.writes()).toHaveLength(1);

    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(1);
  });

  it("si el servidor rechaza, su mensaje se muestra en el diálogo y nada cambia", async () => {
    installServer({
      rejectWith: { message: "No tienes permiso para realizar esta accion.", status: 403 },
    });
    const user = renderCard();

    await user.click(await findSwitch());

    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Permitir vender" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No tienes permiso para realizar esta accion.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await findSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("desactivar: Sí → No, y avisa de la caja abierta de un administrador (7.8)", async () => {
    const api = installServer({
      admins: [
        { ...ana, canSell: true },
        { ...luis, canSell: true },
      ],
      storeSessions: [
        openSession,
        // La caja de un cajero no es asunto de este cambio.
        {
          ...openSession,
          id: "session-2",
          register: { ...openSession.register, assignedUserId: "seller", name: "Caja 2" },
        },
      ],
    });
    const user = renderCard();
    const toggle = await findSwitch();

    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    const dialog = await screen.findByRole("dialog", {
      name: "¿Quitar la venta al administrador?",
    });

    expect(effectRow(dialog, "Vender en el POS")).toHaveTextContent(/Sí.*No/);
    expect(effectRow(dialog, "Operar caja")).toHaveTextContent(/Sí.*No/);

    const openRegisters = await within(dialog).findByRole("list", {
      name: "Cajas abiertas de administradores",
    });

    expect(
      within(openRegisters)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ana Pérez · Caja principal"]);
    expect(dialog).toHaveTextContent(
      "Podrán cerrar ese turno desde Configuración, pero no vender ni abrir uno nuevo.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Quitar la venta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      { body: { enabled: false }, method: "PUT", url: "/api/settings/admin-can-sell" },
    ]);
    expect(await findSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("activar no consulta las cajas abiertas", async () => {
    const api = installServer();
    const user = renderCard();

    await user.click(await findSwitch());
    await screen.findByRole("dialog");

    expect(api.calls.some((call) => call.url.startsWith("/api/cash/"))).toBe(false);
  });

  it("estado parcial: lo dice, y el antes es «Solo algunos»", async () => {
    installServer({ admins: [{ ...ana, canSell: true }, luis] });
    const user = renderCard();
    const toggle = await findSwitch();

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Solo algunos administradores pueden vender/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quitar la venta a todos" }));

    const dialog = await screen.findByRole("dialog", {
      name: "¿Quitar la venta al administrador?",
    });

    expect(effectRow(dialog, "Vender en el POS")).toHaveTextContent(/Solo algunos.*No/);
  });

  it("si no carga, muestra el error del servidor y deja reintentar, sin interruptor", async () => {
    installServer({ failLoad: true });
    renderCard();

    expect(
      await screen.findByText("No tienes permiso para realizar esta accion."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  describe("caos 7.8 · sin cash.operate y con la caja propia abierta", () => {
    beforeEach(() => {
      mockPermissions.delete("cash.operate");
    });

    it("avisa y deja cerrar la caja propia desde Configuración", async () => {
      const api = installServer({ ownSession: openSession });
      const user = renderCard();

      await findSwitch();

      const notice = await screen.findByText(/Tienes abierta la caja/);

      expect(notice).toHaveTextContent("Caja principal");
      expect(notice).toHaveTextContent("no podrás vender ni abrir otro turno");

      await user.click(screen.getByRole("button", { name: "Cerrar mi caja" }));

      const dialog = await screen.findByRole("dialog");

      expect(dialog).toHaveTextContent("Caja principal");
      expect(api.writes()).toHaveLength(0);
    });

    it("sin caja abierta no muestra el aviso", async () => {
      installServer({ ownSession: null });
      renderCard();

      await findSwitch();
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Cerrar mi caja" })).not.toBeInTheDocument(),
      );
    });
  });

  it("con cash.operate no pregunta por la caja propia (la cierra en «Mi caja»)", async () => {
    const api = installServer({ ownSession: openSession });

    renderCard();
    await findSwitch();

    expect(api.calls.map((call) => call.url)).toEqual(["/api/settings/admin-can-sell"]);
    expect(screen.queryByRole("button", { name: "Cerrar mi caja" })).not.toBeInTheDocument();
  });
});
