/**
 * PRO-04 · edición desde el detalle del contacto: el error de un guardado
 * fallido no sigue ahí al volver a abrir el modal.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/contacts/cont-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { ToastProvider } from "../../../shared/components/Toast";
import { ContactDetailsPage } from "./page";

const TAX_ID_TAKEN = "Ya existe un contacto con ese RIF.";

const contact = {
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

describe("ContactDetailsPage · edición (PRO-04)", () => {
  const originalMatchMedia = window.matchMedia;
  let patchResponses: Response[];
  let patches: Array<Record<string, unknown>>;

  beforeEach(() => {
    patchResponses = [];
    patches = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);

        return patchResponses.shift() ?? jsonResponse({ data: contact });
      }

      return new URL(String(input), "http://localhost").pathname === "/api/contacts/cont-1"
        ? jsonResponse({ data: contact })
        : jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("tras una edición fallida, cerrar y reabrir no muestra el error viejo ni en el modal ni en la página", async () => {
    const unhandled = jest.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup({ delay: null });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ContactDetailsPage contactId="cont-1" />
        </ToastProvider>
      </QueryClientProvider>,
    );

    async function openEdit() {
      await user.click(await screen.findByRole("button", { name: "Editar" }));

      return within(await screen.findByRole("dialog", { name: "Editar contacto" }));
    }

    let dialog = await openEdit();

    patchResponses.push(jsonResponse({ error: { code: "CONFLICT", message: TAX_ID_TAKEN } }, 409));
    process.on("unhandledRejection", unhandled);

    try {
      await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));

      // El fallo no cierra el modal: se ve el motivo.
      expect(await dialog.findByText(TAX_ID_TAKEN)).toBeVisible();
      // Node avisa de un rechazo sin manejar en el turno siguiente.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(patches).toHaveLength(1);
    expect(screen.getByText("No pudimos actualizar el contacto")).toBeInTheDocument();
    // Editar no es un alta: no hay aviso de "creado".
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openEdit();

    expect(dialog.queryByText(TAX_ID_TAKEN)).not.toBeInTheDocument();
    expect(screen.queryByText("No pudimos actualizar el contacto")).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Ferretería La Central");

    // El reintento guarda y cierra.
    await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches).toHaveLength(2);
  });
});
