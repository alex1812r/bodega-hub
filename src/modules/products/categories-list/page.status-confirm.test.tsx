/**
 * CNF-12 · desactivar y reactivar una categoría se confirman con
 * `ConfirmActionModal` (sin diálogos nativos) mostrando cuántos productos la usan.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/categories",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { ToastProvider } from "../../../shared/components/Toast";
import { buildCategoryStatusEffects } from "./components/CategoryStatusConfirmModal";
import { CategoriesListPage } from "./page";

const categories = [
  {
    defaultMarkupPct: null,
    description: "",
    id: "cat-bebidas",
    isActive: true,
    name: "Bebidas",
    taxRate: 16,
  },
  {
    defaultMarkupPct: null,
    description: "",
    id: "cat-vieja",
    isActive: false,
    name: "Temporada pasada",
    taxRate: 16,
  },
];

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

type Call = { method: string; url: string };

describe("CategoriesListPage · confirmación de desactivar y reactivar (CNF-12)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let confirmSpy: jest.SpyInstance;
  /** Respuesta del conteo de productos; `null` = el servidor falla. */
  let productCounts: { active: number; total: number } | null;
  /** Respuesta de la mutación; por defecto, éxito. */
  let mutationResponse: () => Promise<Response>;

  beforeEach(() => {
    productCounts = { active: 10, total: 12 };
    mutationResponse = async () => jsonResponse({ data: categories[0] });
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
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
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method !== "GET") {
        return mutationResponse();
      }

      if (url.startsWith("/api/products")) {
        if (!productCounts) {
          return jsonResponse(
            { error: { code: "INTERNAL_ERROR", message: "No se pudo leer el catálogo." } },
            500,
          );
        }

        const query = new URLSearchParams(url.split("?")[1] ?? "");

        return jsonResponse({
          data: {
            items: [],
            limit: 1,
            skip: 0,
            total: query.get("isActive") === "true" ? productCounts.active : productCounts.total,
          },
        });
      }

      return jsonResponse({ data: { items: categories, limit: 10, skip: 0, total: 2 } });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function calls(): Call[] {
    return fetchMock.mock.calls.map(([url, init]) => ({
      method: (init as RequestInit | undefined)?.method ?? "GET",
      url: String(url),
    }));
  }

  function mutations() {
    return calls().filter((call) => call.method !== "GET");
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CategoriesListPage />
        </ToastProvider>
      </QueryClientProvider>,
    );

    return userEvent.setup();
  }

  async function openRowAction(
    user: ReturnType<typeof userEvent.setup>,
    categoryName: string,
    action: string,
  ) {
    const row = (await screen.findByRole("cell", { name: categoryName })).closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "Abrir acciones" }));
    await user.click(await screen.findByRole("menuitem", { name: action }));
  }

  it("desactivar muestra la categoría, sus productos y que siguen vendiéndose, sin diálogo nativo", async () => {
    const user = renderPage();

    await openRowAction(user, "Bebidas", "Desactivar");

    const dialog = await screen.findByRole("dialog", { name: "Desactivar categoría" });
    const effects = await within(dialog).findByRole("list", { name: "Qué va a pasar" });

    expect(within(dialog).getByText("Bebidas")).toBeVisible();
    expect(effects).toHaveTextContent(/Estado de la categoría.*Activa.*Inactiva/);
    expect(effects).toHaveTextContent(/Productos de la categoría.*12 productos \(10 activos\).*Sin cambios/);
    expect(effects).toHaveTextContent(
      "Los 10 productos activos siguen vendiéndose en el POS con su precio y su stock, y conservan la categoría",
    );
    expect(effects).toHaveTextContent(/Filtro por categoría del POS, Productos e Inventario.*Deja de aparecer/);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
    // El conteo sale de un endpoint existente, acotado a la categoría.
    expect(
      calls()
        .filter((call) => call.url.startsWith("/api/products"))
        .map((call) => Object.fromEntries(new URLSearchParams(call.url.split("?")[1]))),
    ).toEqual(
      expect.arrayContaining([
        { categoryId: "cat-bebidas", limit: "1" },
        { categoryId: "cat-bebidas", isActive: "true", limit: "1" },
      ]),
    );
  });

  it("cancelar no llama a la mutación", async () => {
    const user = renderPage();

    await openRowAction(user, "Bebidas", "Desactivar");
    const dialog = await screen.findByRole("dialog", { name: "Desactivar categoría" });

    await within(dialog).findByRole("list", { name: "Qué va a pasar" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mutations()).toEqual([]);
  });

  it("doble clic en confirmar desactiva una sola vez", async () => {
    let resolveMutation: (response: Response) => void = () => undefined;

    mutationResponse = () =>
      new Promise<Response>((resolve) => {
        resolveMutation = resolve;
      });

    const user = renderPage();

    await openRowAction(user, "Bebidas", "Desactivar");
    const dialog = await screen.findByRole("dialog", { name: "Desactivar categoría" });
    const confirmButton = await within(dialog).findByRole("button", {
      name: "Desactivar categoría",
    });

    await user.dblClick(confirmButton);

    expect(mutations()).toEqual([{ method: "DELETE", url: "/api/categories/cat-bebidas" }]);

    resolveMutation(jsonResponse({ data: { ...categories[0], isActive: false } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mutations()).toHaveLength(1);
  });

  it("el error del servidor se muestra tal cual dentro del modal y se puede reintentar", async () => {
    mutationResponse = async () =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Categoria no encontrada." } }, 404);

    const user = renderPage();

    await openRowAction(user, "Bebidas", "Desactivar");
    const dialog = await screen.findByRole("dialog", { name: "Desactivar categoría" });

    await user.click(await within(dialog).findByRole("button", { name: "Desactivar categoría" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Categoria no encontrada.");
    expect(within(dialog).getByRole("button", { name: "Desactivar categoría" })).toBeEnabled();
  });

  it("si el conteo falla muestra el error y no deja confirmar a ciegas", async () => {
    productCounts = null;

    const user = renderPage();

    await openRowAction(user, "Bebidas", "Desactivar");
    const dialog = await screen.findByRole("dialog", { name: "Desactivar categoría" });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo leer el catálogo.",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Desactivar categoría" }),
    ).not.toBeInTheDocument();

    productCounts = { active: 0, total: 0 };
    await user.click(within(dialog).getByRole("button", { name: "Reintentar" }));

    expect(await within(dialog).findByRole("list", { name: "Qué va a pasar" })).toHaveTextContent(
      "Ningún producto usa esta categoría",
    );
    expect(mutations()).toEqual([]);
  });

  it("reactivar muestra lo simétrico y envía isActive una sola vez", async () => {
    productCounts = { active: 1, total: 3 };

    const user = renderPage();

    await openRowAction(user, "Temporada pasada", "Reactivar");

    const dialog = await screen.findByRole("dialog", { name: "Reactivar categoría" });
    const effects = await within(dialog).findByRole("list", { name: "Qué va a pasar" });

    expect(within(dialog).getByText("Temporada pasada")).toBeVisible();
    expect(effects).toHaveTextContent(/Estado de la categoría.*Inactiva.*Activa/);
    expect(effects).toHaveTextContent(/Productos de la categoría.*3 productos \(1 activo\).*Sin cambios/);
    expect(effects).toHaveTextContent(/Filtro por categoría.*Vuelve a aparecer/);
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.dblClick(within(dialog).getByRole("button", { name: "Reactivar categoría" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mutations()).toEqual([{ method: "PATCH", url: "/api/categories/cat-vieja" }]);
    expect(
      JSON.parse(
        String(
          (fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1] as RequestInit)
            .body,
        ),
      ),
    ).toEqual({ isActive: true });
  });

  it("editar sigue siendo directo: abre el formulario sin confirmación", async () => {
    const user = renderPage();

    await openRowAction(user, "Bebidas", "Editar");

    expect(await screen.findByRole("dialog")).not.toHaveAccessibleName("Desactivar categoría");
    expect(calls().some((call) => call.url.startsWith("/api/products"))).toBe(false);
  });
});

describe("buildCategoryStatusEffects", () => {
  it("con productos todos inactivos no promete ventas", () => {
    const labels = buildCategoryStatusEffects("deactivate", { active: 0, total: 4 }).map(
      (effect) => effect.label,
    );

    expect(labels).toContain(
      "Sus productos ya están inactivos: no se venden, con o sin la categoría",
    );
  });

  it("con un solo producto activo habla en singular", () => {
    const effects = buildCategoryStatusEffects("deactivate", { active: 1, total: 1 });

    expect(effects[1]).toMatchObject({ before: "1 producto (1 activo)" });
    expect(effects[2].label).toMatch(/^El producto activo sigue vendiéndose en el POS/);
  });
});
