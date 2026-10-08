/**
 * PRO-04 · edición desde el detalle del producto: el error de un guardado
 * fallido no sigue ahí al volver a abrir el modal.
 * PRO-08 · la tarjeta de cambio de precio recibe el costo actual y envía lo de siempre.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/p-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

import { ProductDetailsPage } from "./page";

const SKU_TAKEN = "Ya existe un producto con ese SKU.";

const product = {
  categoryId: "cat-1",
  currentCostRef: 10,
  currentStock: 10,
  id: "p-1",
  isActive: true,
  minStock: 2,
  name: "Arroz",
  salePriceRef: 12,
  sku: "arroz",
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("ProductDetailsPage", () => {
  const originalMatchMedia = window.matchMedia;
  let patchResponses: Response[];
  let patches: Array<Record<string, unknown>>;
  let posts: Array<{ body: Record<string, unknown>; path: string }>;

  beforeEach(() => {
    patchResponses = [];
    patches = [];
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
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);

        return patchResponses.shift() ?? jsonResponse({ data: product });
      }

      if (init?.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, path });

        return jsonResponse({ data: { history: {}, product } });
      }

      return path === "/api/products/p-1"
        ? jsonResponse({ data: product })
        : jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
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
        <ProductDetailsPage productId="p-1" />
      </QueryClientProvider>,
    );

    return userEvent.setup({ delay: null });
  }

  it("tras una edición fallida, cerrar y reabrir no muestra el error viejo ni en el modal ni en la página (PRO-04)", async () => {
    const unhandled = jest.fn();
    const user = renderPage();

    async function openEdit() {
      await user.click(await screen.findByRole("button", { name: "Editar" }));

      return within(await screen.findByRole("dialog", { name: "Editar producto" }));
    }

    let dialog = await openEdit();

    patchResponses.push(jsonResponse({ error: { code: "CONFLICT", message: SKU_TAKEN } }, 409));
    process.on("unhandledRejection", unhandled);

    try {
      await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));

      // El fallo no cierra el modal: se ve el motivo.
      expect(await dialog.findByText(SKU_TAKEN)).toBeVisible();
      // Node avisa de un rechazo sin manejar en el turno siguiente.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(patches).toHaveLength(1);
    expect(screen.getByText("No pudimos actualizar el producto")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openEdit();

    expect(dialog.queryByText(SKU_TAKEN)).not.toBeInTheDocument();
    expect(screen.queryByText("No pudimos actualizar el producto")).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Arroz");

    // El reintento guarda y cierra. El precio no se tocó: ni viaja ni se pide cambiarlo.
    await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches).toHaveLength(2);
    expect(patches[1]).not.toHaveProperty("salePriceRef");
    expect(posts).toHaveLength(0);
  });

  it("la edición que cambia el precio con un chip lo guarda por el cambio de precio, no por el PATCH (PRO-08)", async () => {
    const user = renderPage();

    await user.click(await screen.findByRole("button", { name: "Editar" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Editar producto" }));

    await user.click(dialog.getByRole("button", { name: "30 %" }));
    await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(patches).toHaveLength(1);
    expect(patches[0]).not.toHaveProperty("salePriceRef");
    expect(posts[0]).toEqual({ body: { salePriceRef: 13 }, path: "/api/products/p-1/price" });
  });

  it("la tarjeta de cambio de precio parte del costo actual y envía solo el precio nuevo (PRO-08)", async () => {
    const user = renderPage();

    const card = within(
      (await screen.findByRole("heading", { name: "Cambio rápido de precio" })).closest(
        "section",
      ) as HTMLElement,
    );

    expect(card.getByText("ref 10.00")).toBeInTheDocument();
    expect(card.getByLabelText("Precio REF")).toHaveValue("12");

    await user.click(card.getByRole("button", { name: "30 %" }));

    expect(card.getByLabelText("Precio REF")).toHaveValue("13");
    expect(card.getByLabelText("Motivo")).toHaveValue("Ajuste de margen a 30 %");

    await user.click(card.getByRole("button", { name: "Actualizar precio" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ body: { salePriceRef: 13 }, path: "/api/products/p-1/price" });
    expect(patches).toHaveLength(0);
  });
});
