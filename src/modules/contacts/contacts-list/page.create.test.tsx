/**
 * PRO-04 · alta de contacto desde la lista: "Guardar y crear otro" y el error
 * de un guardado fallido, que no sigue ahí al volver a abrir el modal.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { ContactsListPage } from "./page";

type UserSession = ReturnType<typeof userEvent.setup>;

const TAX_ID_TAKEN = "Ya existe un contacto con ese RIF.";

const existing = {
  address: "",
  email: "",
  id: "cont-1",
  isActive: true,
  name: "Ferretería La Central",
  phone: "",
  taxId: "J-00000001-1",
  type: "cliente",
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function captureUnhandledRejections() {
  const jestListeners = process.listeners("unhandledRejection");
  const unhandled = jest.fn();

  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", unhandled);

  return {
    restore() {
      process.removeAllListeners("unhandledRejection");
      jestListeners.forEach((listener) => process.on("unhandledRejection", listener));
    },
    unhandled,
  };
}

describe("ContactsListPage · alta de contacto (PRO-04)", () => {
  const originalMatchMedia = window.matchMedia;
  let postResponses: Response[];
  let posts: Array<Record<string, unknown>>;

  beforeEach(() => {
    postResponses = [];
    posts = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);

        return postResponses.shift() ?? jsonResponse({ error: { code: "X", message: "Sin cola" } }, 500);
      }

      return jsonResponse({ data: { items: [existing], limit: 10, skip: 0, total: 1 } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ContactsListPage />
      </QueryClientProvider>,
    );

    return userEvent.setup({ delay: null });
  }

  async function openCreate(user: UserSession) {
    await user.click(screen.getByRole("button", { name: "Nuevo contacto" }));

    return within(await screen.findByRole("dialog", { name: "Crear contacto" }));
  }

  async function fillName(user: UserSession, name: string) {
    await user.click(within(screen.getByRole("dialog")).getByLabelText("Nombre"));
    await user.paste(name);
  }

  it("tras un guardado fallido, cerrar y reabrir el alta no muestra el error viejo", async () => {
    const user = renderPage();
    const rejections = captureUnhandledRejections();

    await screen.findAllByText("Ferretería La Central");

    let dialog = await openCreate(user);

    postResponses.push(jsonResponse({ error: { code: "CONFLICT", message: TAX_ID_TAKEN } }, 409));

    try {
      await fillName(user, "Distribuidora Polar");
      await user.click(dialog.getByRole("button", { name: "Crear contacto" }));
      await waitFor(() => expect(rejections.unhandled).toHaveBeenCalledTimes(1));
    } finally {
      rejections.restore();
    }

    // El fallo no cierra ni limpia: se ve el motivo junto a lo escrito.
    expect(await dialog.findByText(TAX_ID_TAKEN)).toBeVisible();
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue("Distribuidora Polar");

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openCreate(user);

    expect(dialog.queryByText(TAX_ID_TAKEN)).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue("");
  });

  it("Guardar y crear otro: crea, deja el alta abierta y vacía con el mismo tipo, y el siguiente también se guarda", async () => {
    const user = renderPage();

    await screen.findAllByText("Ferretería La Central");

    const dialog = await openCreate(user);

    postResponses.push(
      jsonResponse({ data: { ...existing, id: "cont-2", name: "Distribuidora Polar" } }, 201),
      jsonResponse({ data: { ...existing, id: "cont-3", name: "Alimentos Mary" } }, 201),
    );

    await fillName(user, "Distribuidora Polar");
    await user.selectOptions(dialog.getByLabelText("Tipo"), "proveedor");
    await user.click(dialog.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue(""));
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveFocus();
    expect(dialog.getByLabelText("Tipo")).toHaveValue("proveedor");
    expect(screen.getByRole("dialog", { name: "Crear contacto" })).toBeInTheDocument();

    await fillName(user, "Alimentos Mary");
    await user.click(dialog.getByRole("button", { name: "Crear contacto" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ name: "Distribuidora Polar", type: "proveedor" });
    expect(posts[1]).toMatchObject({ name: "Alimentos Mary", type: "proveedor" });
  });
});
