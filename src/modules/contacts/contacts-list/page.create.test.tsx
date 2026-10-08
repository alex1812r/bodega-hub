/**
 * PRO-04 · alta de contacto desde la lista: "Guardar y crear otro", el aviso
 * del contacto creado y el error de un guardado fallido (alta o edición), que
 * no sigue ahí al volver a abrir el modal.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { ToastProvider } from "../../../shared/components/Toast";
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

/**
 * Vigila los rechazos sin manejar: el formulario captura el de `onSubmit` y
 * no debe quedar ninguno (en el navegador sería un `pageerror` por guardado fallido).
 */
function watchUnhandledRejections() {
  const unhandled = jest.fn();

  process.on("unhandledRejection", unhandled);

  return {
    /** Node avisa de un rechazo sin manejar en el turno siguiente: se le da ese turno. */
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    stop() {
      process.off("unhandledRejection", unhandled);
    },
    unhandled,
  };
}

describe("ContactsListPage · alta de contacto (PRO-04)", () => {
  const originalMatchMedia = window.matchMedia;
  let patchResponses: Response[];
  let postResponses: Response[];
  let posts: Array<Record<string, unknown>>;

  beforeEach(() => {
    patchResponses = [];
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

      if (init?.method === "PATCH") {
        return patchResponses.shift() ?? jsonResponse({ data: existing });
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
        <ToastProvider>
          <ContactsListPage />
        </ToastProvider>
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
    const rejections = watchUnhandledRejections();

    await screen.findAllByText("Ferretería La Central");

    let dialog = await openCreate(user);

    postResponses.push(jsonResponse({ error: { code: "CONFLICT", message: TAX_ID_TAKEN } }, 409));

    try {
      await fillName(user, "Distribuidora Polar");
      await user.click(dialog.getByRole("button", { name: "Crear contacto" }));
      // El fallo no cierra ni limpia: se ve el motivo junto a lo escrito.
      expect(await dialog.findByText(TAX_ID_TAKEN)).toBeVisible();
      await rejections.settle();
    } finally {
      rejections.stop();
    }

    expect(rejections.unhandled).not.toHaveBeenCalled();
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

    // Un aviso por contacto, cada uno con el enlace a su detalle.
    const toasts = within(screen.getByRole("status"));

    expect(toasts.getByText("Contacto creado: Distribuidora Polar")).toBeInTheDocument();
    expect(await toasts.findByText("Contacto creado: Alimentos Mary")).toBeInTheDocument();
    expect(toasts.getAllByRole("link", { name: "Ver" }).map((link) => link.getAttribute("href"))).toEqual([
      "/contacts/cont-2",
      "/contacts/cont-3",
    ]);
  });

  it("tras una edición fallida, cerrar y reabrir la edición no muestra el error viejo", async () => {
    const user = renderPage();
    const rejections = watchUnhandledRejections();

    await screen.findAllByText("Ferretería La Central");

    async function openEdit() {
      await user.click(screen.getAllByRole("button", { name: "Abrir acciones" })[0]);
      await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

      return within(await screen.findByRole("dialog", { name: "Editar contacto" }));
    }

    let dialog = await openEdit();

    patchResponses.push(jsonResponse({ error: { code: "CONFLICT", message: TAX_ID_TAKEN } }, 409));

    try {
      await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));

      // El fallo no cierra el modal: se ve el motivo.
      expect(await dialog.findByText(TAX_ID_TAKEN)).toBeVisible();
      await rejections.settle();
    } finally {
      rejections.stop();
    }

    expect(rejections.unhandled).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openEdit();

    expect(dialog.queryByText(TAX_ID_TAKEN)).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Ferretería La Central");
  });
});
