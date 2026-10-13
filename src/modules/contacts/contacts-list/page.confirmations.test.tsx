/**
 * CNF-13 · lista de contactos: desactivar confirma con su efecto (un proveedor
 * suelta el «habitual» de sus productos); reactivar y navegar son directos.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("./components/ContactsExportActions", () => ({
  ContactsExportActions: () => null,
}));

import { ToastProvider } from "../../../shared/components/Toast";
import { buildContactDeactivateEffects } from "./components/ContactDeactivateConfirmModal";
import { ContactsListPage } from "./page";

type ContactRow = { id: string; isActive: boolean; name: string; type: string };

function contactRow(row: ContactRow) {
  return { address: "", email: "", phone: "", taxId: `J-${row.id}`, ...row };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("ContactsListPage · confirmaciones (CNF-13)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let contacts: ContactRow[] = [];
  /** Vínculos activos del proveedor; `null` = el servidor falla. */
  let supplierLinks: { isPreferred: boolean }[] | null = [];
  let supplierLinksTotal: number | undefined;
  let patchResponse: () => Response = () => jsonResponse({ data: {} });

  beforeEach(() => {
    contacts = [];
    supplierLinks = [];
    supplierLinksTotal = undefined;
    patchResponse = () => jsonResponse({ data: {} });
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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];

      if (init?.method === "PATCH") {
        return patchResponse();
      }

      if (path.startsWith("/api/suppliers/")) {
        if (supplierLinks === null) {
          return jsonResponse({ error: { code: "INTERNAL", message: "Sin conexión" } }, 500);
        }

        return jsonResponse({
          data: {
            items: supplierLinks,
            limit: 100,
            skip: 0,
            total: supplierLinksTotal ?? supplierLinks.length,
          },
        });
      }

      return jsonResponse({
        data: { items: contacts.map(contactRow), limit: 10, skip: 0, total: contacts.length },
      });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function patchCalls() {
    return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ContactsListPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  async function selectRowAction(user: ReturnType<typeof userEvent.setup>, name: string) {
    await screen.findByText(contacts[0].name);
    await user.click(screen.getAllByRole("button", { name: /acciones/i })[0]);
    await user.click(await screen.findByRole("menuitem", { name }));
  }

  it("desactivar un proveedor no muta hasta confirmar y dice de cuántos productos es el habitual", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "s-1", isActive: true, name: "Distribuidora Sol", type: "proveedor" }];
    supplierLinks = [{ isPreferred: true }, { isPreferred: true }, { isPreferred: false }];
    renderPage();
    await selectRowAction(user, "Desactivar");

    const dialog = await screen.findByRole("dialog", { name: "Confirmar desactivación" });

    expect(patchCalls()).toHaveLength(0);
    expect(within(dialog).getByText("Distribuidora Sol")).toBeInTheDocument();
    await waitFor(() =>
      expect(dialog).toHaveTextContent(/Proveedor habitual.*2 productos.*Deja de serlo/),
    );
    expect(dialog).toHaveTextContent(/Estado del contacto.*Activo.*Inactivo/);

    await user.dblClick(within(dialog).getByRole("button", { name: "Desactivar contacto" }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0][0]).toBe("/api/contacts/s-1");
    expect(JSON.parse(String((patchCalls()[0][1] as RequestInit).body))).toEqual({
      isActive: false,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Confirmar desactivación" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("cancelar la confirmación no desactiva", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "c-1", isActive: true, name: "Cliente Uno", type: "cliente" }];
    renderPage();
    await selectRowAction(user, "Desactivar");

    const dialog = await screen.findByRole("dialog", { name: "Confirmar desactivación" });

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Confirmar desactivación" }),
      ).not.toBeInTheDocument(),
    );
    expect(patchCalls()).toHaveLength(0);
  });

  it("un cliente no consulta vínculos de proveedor y confirma con su estado", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "c-1", isActive: true, name: "Cliente Uno", type: "cliente" }];
    renderPage();
    await selectRowAction(user, "Desactivar");

    const dialog = await screen.findByRole("dialog", { name: "Confirmar desactivación" });

    expect(dialog).toHaveTextContent(/Estado del contacto.*Activo.*Inactivo/);
    expect(dialog).not.toHaveTextContent("Proveedor habitual");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/suppliers/")),
    ).toBe(false);
  });

  it("si no se pueden leer los productos del proveedor, no deja desactivar a ciegas", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "s-1", isActive: true, name: "Distribuidora Sol", type: "ambos" }];
    supplierLinks = null;
    renderPage();
    await selectRowAction(user, "Desactivar");

    const dialog = await screen.findByRole("dialog", { name: "Confirmar desactivación" });

    expect(await within(dialog).findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Desactivar contacto" }),
    ).not.toBeInTheDocument();
    expect(patchCalls()).toHaveLength(0);
  });

  it("si el servidor rechaza, el motivo se lee en el diálogo", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "c-1", isActive: true, name: "Consumidor final", type: "cliente" }];
    patchResponse = () =>
      jsonResponse(
        {
          error: {
            code: "BAD_REQUEST",
            message: "No se puede desactivar el cliente default del POS.",
          },
        },
        400,
      );
    renderPage();
    await selectRowAction(user, "Desactivar");

    const dialog = await screen.findByRole("dialog", { name: "Confirmar desactivación" });

    await user.click(within(dialog).getByRole("button", { name: "Desactivar contacto" }));

    expect(
      await within(dialog).findByText("No se puede desactivar el cliente default del POS."),
    ).toBeInTheDocument();
  });

  it("reactivar es directo: un clic ejecuta sin diálogo", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "c-2", isActive: false, name: "Cliente Dos", type: "cliente" }];
    renderPage();
    await selectRowAction(user, "Activar");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(JSON.parse(String((patchCalls()[0][1] as RequestInit).body))).toEqual({
      isActive: true,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("«Ver perfil» es un enlace directo, sin diálogo", async () => {
    const user = userEvent.setup();

    contacts = [{ id: "c-1", isActive: true, name: "Cliente Uno", type: "cliente" }];
    renderPage();
    await screen.findByText("Cliente Uno");
    await user.click(screen.getAllByRole("button", { name: /acciones/i })[0]);

    expect(await screen.findByRole("menuitem", { name: "Ver perfil" })).toHaveAttribute(
      "href",
      expect.stringContaining("/contacts/c-1"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("buildContactDeactivateEffects (CNF-13)", () => {
  it("con más vínculos de los leídos la cuenta se anuncia como mínimo", () => {
    const effects = buildContactDeactivateEffects({ count: 3, isPartial: true });

    expect(effects[1]).toMatchObject({ before: "Al menos 3 productos", label: "Proveedor habitual" });
  });

  it("un proveedor que no es habitual de nada lo dice", () => {
    const labels = buildContactDeactivateEffects({ count: 0, isPartial: false }).map(
      (effect) => effect.label,
    );

    expect(labels).toContain("No es el proveedor habitual de ningún producto");
  });

  it("un cliente solo cambia de estado y conserva su historial", () => {
    expect(buildContactDeactivateEffects(null).map((effect) => effect.label)).toEqual([
      "Estado del contacto",
      "Sus ventas, compras, pagos y saldos se conservan",
    ]);
  });
});
