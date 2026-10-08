/**
 * PRO-04 · alta de producto desde la lista: el alta devuelve el producto creado
 * y el error de un guardado fallido no sigue ahí al volver a abrir el modal.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

import { ProductsListPage } from "./page";

type UserSession = ReturnType<typeof userEvent.setup>;

const SKU_TAKEN = "Ya existe un producto con ese SKU.";

const existing = {
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 10,
  id: "p-1",
  isActive: true,
  minStock: 2,
  name: "Arroz",
  salePriceRef: 2,
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

describe("ProductsListPage · alta de producto (PRO-04)", () => {
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
    window.history.replaceState(null, "", "/products");
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);

        return postResponses.shift() ?? jsonResponse({ error: { code: "X", message: "Sin cola" } }, 500);
      }

      if (url.startsWith("/api/products")) {
        return jsonResponse({ data: { items: [existing], limit: 10, skip: 0, total: 1 } });
      }

      if (url.startsWith("/api/categories")) {
        return jsonResponse({
          data: {
            items: [{ id: "cat-1", isActive: true, name: "Víveres", taxRate: 16 }],
            limit: 10,
            skip: 0,
            total: 1,
          },
        });
      }

      return jsonResponse({ data: { id: "rate-1", rateVes: 50 } });
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
        <ProductsListPage />
      </QueryClientProvider>,
    );

    return userEvent.setup({ delay: null });
  }

  async function openCreate(user: UserSession) {
    await user.click(screen.getByRole("button", { name: "Nuevo producto" }));

    return within(await screen.findByRole("dialog", { name: "Crear producto" }));
  }

  async function fillBasics(user: UserSession, name: string) {
    await user.click(within(screen.getByRole("dialog")).getByLabelText("Nombre"));
    await user.paste(name);
    await user.click(within(screen.getByRole("dialog")).getByLabelText("Precio REF"));
    await user.paste("2");
  }

  it("tras un guardado fallido, cerrar y reabrir el alta no muestra el error viejo", async () => {
    const user = renderPage();
    const rejections = captureUnhandledRejections();

    await screen.findByRole("link", { name: "Arroz" });

    let dialog = await openCreate(user);

    postResponses.push(jsonResponse({ error: { code: "CONFLICT", message: SKU_TAKEN } }, 409));

    try {
      await fillBasics(user, "Harina");
      await user.click(dialog.getByRole("button", { name: "Crear producto" }));
      await waitFor(() => expect(rejections.unhandled).toHaveBeenCalledTimes(1));
    } finally {
      rejections.restore();
    }

    // El fallo no cierra ni limpia: se ve el motivo junto a lo escrito.
    expect(await dialog.findByText(SKU_TAKEN)).toBeVisible();
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue("Harina");

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openCreate(user);

    expect(dialog.queryByText(SKU_TAKEN)).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue("");
  });

  it("Guardar y crear otro: crea, deja el alta abierta y vacía, y el siguiente también se guarda", async () => {
    const user = renderPage();

    await screen.findByRole("link", { name: "Arroz" });

    const dialog = await openCreate(user);

    postResponses.push(
      jsonResponse({ data: { ...existing, id: "p-2", name: "Harina", sku: "harina" } }, 201),
      jsonResponse({ data: { ...existing, id: "p-3", name: "Aceite", sku: "aceite" } }, 201),
    );

    await fillBasics(user, "Harina");
    await user.selectOptions(dialog.getByLabelText("Categoría"), "cat-1");
    await user.click(dialog.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue(""));
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveFocus();
    expect(dialog.getByLabelText("Categoría")).toHaveValue("cat-1");
    expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();

    await fillBasics(user, "Aceite");
    await user.click(dialog.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ categoryId: "cat-1", name: "Harina", salePriceRef: 2 });
    expect(posts[1]).toMatchObject({ categoryId: "cat-1", name: "Aceite", salePriceRef: 2 });
  });
});
