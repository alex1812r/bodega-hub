/**
 * POS-F8 (QA de POS-F7, R1) · tras vender en el POS, «Mi caja» montaba con la caché de
 * antes de la venta: «Efectivo en cajón Bs. 0,00» y el cierre prellenado con 0. Aceptarlo
 * cerraba con un faltante falso (contado 0 contra un teórico de 7.618,16).
 *
 * Se monta la pantalla REAL con QueryClient y `fetch` simulado por URL.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { formatVesBs } from "@/shared/utils/currency";

import { CashDeskPage } from "./page";

jest.mock("next/navigation", () => ({
  usePathname: () => "/cash",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const SALE_VES = 7618.16;
const REGISTER = { assignedUserId: "user-1", id: "reg-1", isActive: true, name: "Caja Lab 1" };
const SESSION = {
  id: "session-1",
  liveTotals: { cashRef: 0, cashVes: 0 },
  openedAt: new Date().toISOString(),
  openingRef: 0,
  openingVes: 0,
  register: REGISTER,
  registerId: REGISTER.id,
  status: "open",
};
const SALE_MOVEMENT = {
  amountRef: 0,
  amountVes: SALE_VES,
  createdAt: new Date().toISOString(),
  id: "mov-1",
  notes: "V-20261010-000001",
  sessionId: SESSION.id,
  type: "sale_in",
};

function totals(ves: number) {
  return {
    accountVes: 0,
    items: ves > 0 ? [SALE_MOVEMENT] : [],
    theoretical: { ref: 0, ves },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

type MovementsReply = { error: string } | { ves: number };

/** BFF simulado. Las lecturas de movimientos se sirven a mano, una a una, con `serveMovements`. */
function mountBackend() {
  const requests: string[] = [];
  const closePosts: unknown[] = [];
  const pendingMovements: Array<(reply: MovementsReply) => void> = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const route = `${init?.method ?? "GET"} ${url.pathname}`;

    requests.push(route);

    switch (route) {
      case "GET /api/auth/me":
        return jsonResponse({
          data: {
            deniedPermissions: [],
            grantedPermissions: [],
            permissionCatalog: [],
            permissions: [],
            role: "vendedor",
            roles: ["vendedor"],
            storeId: "store-1",
            user: { email: "vendedor@example.com", id: REGISTER.assignedUserId, name: "Vendedor" },
          },
        });
      case "GET /api/cash/registers":
        return jsonResponse({ data: [REGISTER] });
      case "GET /api/cash/session":
        return jsonResponse({ data: closePosts.length > 0 ? null : SESSION });
      case "GET /api/settings/cash-close":
        return jsonResponse({ data: { cashCloseDiffAlertVes: 0 } });
      case "GET /api/cash/movements": {
        const reply = await new Promise<MovementsReply>((resolve) => {
          pendingMovements.push(resolve);
        });

        return "error" in reply
          ? jsonResponse({ error: { code: "INTERNAL", message: reply.error } }, 500)
          : jsonResponse({ data: totals(reply.ves) });
      }
      case "POST /api/cash/session/close":
        closePosts.push(JSON.parse(String(init?.body ?? "{}")));

        return jsonResponse({ data: { ...SESSION, status: "closed" } });
      default:
        return jsonResponse({ error: { code: "NOT_FOUND", message: route } }, 404);
    }
  }) as typeof fetch;

  return {
    closePosts,
    movementReads: () => requests.filter((route) => route === "GET /api/cash/movements").length,
    /** Responde la lectura de movimientos que esté esperando (falla si no hay ninguna). */
    async serveMovements(reply: MovementsReply) {
      await waitFor(() => expect(pendingMovements.length).toBeGreaterThan(0));
      pendingMovements.shift()?.(reply);
    },
  };
}

/** Caché como la deja el POS al cargar: sesión y movimientos recién leídos, con el cajón en 0. */
function mountCashDesk() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, staleTime: 30_000 } },
  });

  queryClient.setQueryData(["cash", "session"], SESSION);
  queryClient.setQueryData(["cash", "registers"], [REGISTER]);
  queryClient.setQueryData(["cash", "movements", SESSION.id], totals(0));

  render(
    <QueryClientProvider client={queryClient}>
      <CashDeskPage />
    </QueryClientProvider>,
  );
}

async function openCloseDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Cerrar caja" }));

  return within(await screen.findByRole("dialog", { name: "Cerrar caja" }));
}

const COUNTED_VES_LABEL = "Efectivo contado Bs. (cajón completo)";
const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // Escritorio: la tabla de movimientos se pinta como tabla.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
    writable: true,
  });
});

describe("POS-F8 · «Mi caja» no enseña ni cierra con el dinero de la caché", () => {
  it("con caché reciente (cajón 0) relee al montar y no enseña movimientos ni cajón viejos mientras tanto", async () => {
    const backend = mountBackend();

    mountCashDesk();

    await waitFor(() => expect(backend.movementReads()).toBe(1));
    expect(screen.queryByText("No hay movimientos.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Actualizando…").length).toBeGreaterThan(0);

    await backend.serveMovements({ ves: SALE_VES });

    expect(await screen.findByText("Efectivo venta")).toBeInTheDocument();
    expect(screen.getAllByText(formatVesBs(SALE_VES)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });

  it("el cierre abierto con la relectura en curso no prellena 0 ni deja confirmar; al llegar prellena lo real y cierra con UNA petición", async () => {
    const user = userEvent.setup();
    const backend = mountBackend();

    mountCashDesk();

    const dialog = await openCloseDialog(user);

    expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("");
    expect(dialog.getByRole("button", { name: "Cerrar caja" })).toBeDisabled();
    expect(dialog.getByRole("status")).toHaveTextContent("Actualizando");

    // Aunque se pulse, no sale ningún cierre.
    await user.click(dialog.getByRole("button", { name: "Cerrar caja" }));
    expect(backend.closePosts).toHaveLength(0);

    await backend.serveMovements({ ves: SALE_VES });

    await waitFor(() => expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("7618.16"));
    expect(dialog.getAllByText(formatVesBs(SALE_VES)).length).toBeGreaterThan(0);

    await user.dblClick(dialog.getByRole("button", { name: "Cerrar caja" }));

    await waitFor(() => expect(backend.closePosts).toHaveLength(1));
    expect(backend.closePosts[0]).toEqual({
      closingRef: 0,
      closingVes: SALE_VES,
      sessionId: SESSION.id,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Cerrar caja" })).not.toBeInTheDocument(),
    );
    expect(backend.closePosts).toHaveLength(1);
  });

  it("cada apertura del cierre vuelve a leer: una venta posterior a la carga de «Mi caja» entra en el prellenado", async () => {
    const user = userEvent.setup();
    const backend = mountBackend();

    mountCashDesk();
    // «Mi caja» carga con el cajón realmente en 0…
    await backend.serveMovements({ ves: 0 });
    expect(await screen.findByText("No hay movimientos.")).toBeInTheDocument();

    // …y la venta ocurre después (otra pestaña): al abrir el cierre se relee.
    const dialog = await openCloseDialog(user);

    await waitFor(() => expect(backend.movementReads()).toBe(2));
    expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("");
    expect(dialog.getByRole("button", { name: "Cerrar caja" })).toBeDisabled();

    await backend.serveMovements({ ves: SALE_VES });

    await waitFor(() => expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("7618.16"));
    expect(dialog.getByRole("button", { name: "Cerrar caja" })).toBeEnabled();
  });

  it("un cajón realmente en 0 sí se prellena con 0 y deja cerrar", async () => {
    const user = userEvent.setup();
    const backend = mountBackend();

    mountCashDesk();

    const dialog = await openCloseDialog(user);

    await backend.serveMovements({ ves: 0 });

    await waitFor(() => expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("0"));
    expect(dialog.getByRole("button", { name: "Cerrar caja" })).toBeEnabled();
  });

  it("si la relectura falla lo dice, no deja cerrar con el teórico viejo y permite reintentar", async () => {
    const user = userEvent.setup();
    const backend = mountBackend();

    mountCashDesk();

    const dialog = await openCloseDialog(user);

    await backend.serveMovements({ error: "No pudimos leer los movimientos de caja." });

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "No pudimos leer los movimientos de caja.",
    );
    expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("");
    expect(dialog.getByRole("button", { name: "Cerrar caja" })).toBeDisabled();

    await user.click(dialog.getByRole("button", { name: "Cerrar caja" }));
    expect(backend.closePosts).toHaveLength(0);

    await user.click(dialog.getByRole("button", { name: "Reintentar" }));
    await backend.serveMovements({ ves: SALE_VES });

    await waitFor(() => expect(dialog.getByLabelText(COUNTED_VES_LABEL)).toHaveValue("7618.16"));
    expect(dialog.getByRole("button", { name: "Cerrar caja" })).toBeEnabled();
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
  });
});
