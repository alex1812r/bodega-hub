/**
 * PRO-11 · cola "Por revisar" en la lista de productos: aviso en las filas,
 * filtro `?review=1`, selección y reprecio masivo, y "Mantener precio".
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

let mockPermissions: string[] = [];

jest.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.includes(permission),
    isLoading: false,
    role: "admin",
  }),
}));
jest.mock("../product-details/components/ProductFormModal", () => ({
  ProductFormModal: () => null,
}));

import { ProductsListPage } from "./page";

// Cada caso monta la página entera (tabla, filtros, barra y modales) y tarda menos de 1 s
// aislado, sin esperas reales (userEvent va sin retardo). En `npm test` completo, con todos
// los workers ocupados, alguno pasó de los 5 s por defecto: margen solo para este archivo.
jest.setTimeout(20_000);

const LONG_NAME = "X".repeat(115);

function review(previousCostRef: number, currentCostRef: number, salePriceRef: number) {
  return {
    currentBand: "low",
    currentCostRef,
    currentMarginPct: Math.round(((salePriceRef - currentCostRef) / currentCostRef) * 10000) / 100,
    previousBand: "high",
    previousCostRef,
    previousMarginPct:
      Math.round(((salePriceRef - previousCostRef) / previousCostRef) * 10000) / 100,
    snapshotAt: "2026-10-01T10:00:00.000Z",
  };
}

function product(
  id: string,
  name: string,
  currentCostRef: number,
  salePriceRef: number,
  priceReview?: ReturnType<typeof review>,
) {
  return {
    categoryId: "cat-1",
    currentCostRef,
    currentStock: 10,
    id,
    isActive: true,
    minStock: 2,
    name,
    ...(priceReview ? { priceReview } : {}),
    salePriceRef,
    sku: id,
  };
}

const ARROZ = product("p-arroz", "Arroz", 9, 10, review(8, 9, 10)); // 25 % → 11,11 %
const HARINA = product("p-harina", "Harina", 10, 11, review(8.8, 10, 11)); // 25 % → 10 %
const SAL = product("p-sal", "Sal", 0, 3, review(2, 2.9, 3));
const ACEITE = product("p-aceite", LONG_NAME, 10, 15);

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("ProductsListPage · Por revisar (PRO-11)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let isMobile = false;
  let queue: Array<ReturnType<typeof product>>;
  let posts: Array<{ body: Record<string, unknown>; path: string }>;
  let repriceResponse: () => Response | Promise<Response>;

  beforeEach(() => {
    isMobile = false;
    mockPermissions = ["products.view", "products.manage"];
    queue = [ARROZ, HARINA, SAL];
    posts = [];
    repriceResponse = () => jsonResponse({ data: { failed: 0, results: [], updated: 0 } });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: isMobile,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const [path, query = ""] = String(input).split("?");

      if (init?.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, path });

        return path === "/api/products/price-review/reprice"
          ? repriceResponse()
          : jsonResponse({ data: { history: { kind: "keep" }, product: ARROZ } });
      }

      if (path === "/api/products/price-review/summary") {
        return jsonResponse({ data: { total: queue.length } });
      }

      if (path === "/api/products") {
        const items =
          new URLSearchParams(query).get("review") === "1" ? queue : [...queue, ACEITE];

        return jsonResponse({ data: { items, limit: 10, skip: 0, total: items.length } });
      }

      if (path === "/api/settings/pricing") {
        return jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
      }

      if (path === "/api/categories") {
        return jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
      }

      return jsonResponse({ data: { id: "rate-1", rateVes: 50 } });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage(query = "") {
    window.history.replaceState(null, "", query ? `/products?${query}` : "/products");

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ProductsListPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/products")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function requestsTo(path: string) {
    return fetchMock.mock.calls.filter(([url]) => String(url).split("?")[0] === path).length;
  }

  async function findRow(name: string) {
    const link = await screen.findByRole("link", { name });
    const row = link.closest("tr");

    if (!row) {
      throw new Error(`Sin fila para ${name}`);
    }

    return row;
  }

  const reviewChip = () => screen.getByRole("button", { name: /^Por revisar/ });

  it("marks the rows under review with an accessible warning that explains the drop", async () => {
    renderPage();

    const row = await findRow("Arroz");
    const badge = within(row).getByTitle(
      "La ganancia bajó de 25 % a 11,11 % al subir el costo de ref 8.00 a ref 9.00",
    );

    expect(badge).toHaveTextContent("Por revisar");
    expect(badge).toHaveTextContent("La ganancia bajó de 25 % a 11,11 %");
    // Dentro de la celda del nombre: sin columna nueva, la tabla sigue en 8 + acciones.
    expect(badge.closest("td")).toBe(within(row).getByRole("link", { name: "Arroz" }).closest("td"));
    expect(
      screen.getAllByRole("columnheader").filter((header) => header.getAttribute("scope") === "col"),
    ).toHaveLength(8);

    const plainRow = await findRow(LONG_NAME);

    expect(plainRow.querySelector("[data-price-review]")).toBeNull();
  });

  it("breaks a long name without spaces instead of widening the table", async () => {
    renderPage();

    const name = within(await findRow(LONG_NAME)).getByTitle(LONG_NAME);

    expect(name).toHaveClass("min-w-0", "line-clamp-2", "[overflow-wrap:anywhere]");
    expect(name.closest("a")).toHaveClass("min-w-0");
    expect(name.closest("a")?.parentElement).toHaveClass("min-w-0");
  });

  it("shows the warning on the mobile cards too", async () => {
    isMobile = true;
    renderPage();

    const link = await screen.findByRole("link", { name: "Arroz" });

    expect(link.closest("tr")).toBeNull();
    expect(
      within(link.closest("article, li, div[class*='rounded']") as HTMLElement).getByText(
        "Por revisar",
      ),
    ).toBeInTheDocument();
  });

  it("leaves the usual list alone without the review parameter", async () => {
    renderPage();
    await findRow("Arroz");

    expect(listRequests().at(-1)).not.toHaveProperty("review");
    expect(reviewChip()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Reprecio/ })).not.toBeInTheDocument();
  });

  it("writes the filter as ?review=1 with its counter and combines it with the other filters", async () => {
    const user = userEvent.setup({ delay: null });

    renderPage();
    await findRow("Arroz");
    await waitFor(() => expect(screen.getByTestId("price-review-count")).toHaveTextContent("3"));

    await user.click(reviewChip());

    expect(window.location.search).toBe("?review=1");
    expect(reviewChip()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(listRequests().at(-1)).toMatchObject({ review: "1" }));

    await user.selectOptions(screen.getByLabelText("Ganancia"), "Baja");

    expect(window.location.search).toBe("?margin=low&review=1");
    await waitFor(() => expect(listRequests().at(-1)).toMatchObject({ margin: "low", review: "1" }));

    await user.click(reviewChip());

    expect(window.location.search).toBe("?margin=low");
    await waitFor(() => expect(listRequests().at(-1)).not.toHaveProperty("review"));
  });

  it("reads ?review=1 from the URL on mount", async () => {
    renderPage("review=1&status=active");
    await findRow("Arroz");

    expect(listRequests().at(-1)).toMatchObject({ isActive: "true", review: "1" });
    expect(reviewChip()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("link", { name: LONG_NAME })).not.toBeInTheDocument();
  });

  it("has its own empty state when nothing dropped", async () => {
    queue = [];
    renderPage("review=1");

    expect(await screen.findByText("Ningún producto bajó de ganancia")).toBeInTheDocument();
    expect(screen.queryByText("No hay productos para mostrar")).not.toBeInTheDocument();
  });

  it("selects rows and the whole page, and forgets the selection when a filter changes", async () => {
    const user = userEvent.setup({ delay: null });

    renderPage("review=1");
    await findRow("Arroz");

    const bar = within(screen.getByRole("region", { name: "Reprecio de los productos seleccionados" }));

    expect(bar.getByText("0 seleccionados")).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Reprecio al 30 %" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Arroz" }));

    expect(bar.getByText("1 seleccionado")).toBeInTheDocument();
    expect(window.location.search).toBe("?review=1");

    await user.click(bar.getByRole("checkbox", { name: "Seleccionar página" }));

    expect(bar.getByText("3 seleccionados")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Seleccionar Sal" })).toBeChecked();

    await user.selectOptions(screen.getByLabelText("Ganancia"), "Baja");

    await waitFor(() => expect(bar.getByText("0 seleccionados")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Seleccionar Arroz" })).not.toBeChecked();
  });

  it("confirms the reprice with real figures and sends it once on a double click", async () => {
    const user = userEvent.setup({ delay: null });
    let release: (response: Response) => void = () => undefined;

    repriceResponse = () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      });
    renderPage("review=1");
    await findRow("Arroz");
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Arroz" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Harina" }));
    await user.click(screen.getByRole("button", { name: "Reprecio al 30 %" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(
      dialog.getByText("Vas a cambiar el precio de 2 productos al 30 % sobre su costo."),
    ).toBeInTheDocument();

    const preview = within(
      dialog.getByRole("list", { name: "Precio y ganancia antes y después" }),
    ).getAllByRole("listitem");

    // 9 × 1,30 = 11,70 y 10 × 1,30 = 13,00: el mismo cálculo que el servidor.
    expect(preview[0]).toHaveTextContent(/Arroz.*ref 10\.00.*ref 11\.70/);
    expect(preview[1]).toHaveTextContent(/Harina.*ref 11\.00.*ref 13\.00/);
    expect(posts).toHaveLength(0);

    const confirm = dialog.getByRole("button", { name: "Cambiar 2 precios" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      // Cada producto con el costo de la vista previa (PRO-F9, ALTA-1).
      body: {
        items: [
          { expectedCostRef: 9, productId: "p-arroz" },
          { expectedCostRef: 10, productId: "p-harina" },
        ],
        markupPct: 30,
      },
      path: "/api/products/price-review/reprice",
    });

    release(
      jsonResponse({
        data: {
          failed: 0,
          results: [
            { productId: "p-arroz", salePriceRef: 11.7, status: "ok" },
            { productId: "p-harina", salePriceRef: 13, status: "ok" },
          ],
          updated: 2,
        },
      }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toHaveLength(1);
  });

  it("reprices with a free % typed by the user", async () => {
    const user = userEvent.setup({ delay: null });

    renderPage("review=1");
    await findRow("Arroz");
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Arroz" }));
    await user.type(screen.getByLabelText("Otro %"), "17,5");
    await user.click(screen.getByRole("button", { name: "Aplicar 17,5 %" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(
      dialog.getByText("Vas a cambiar el precio de 1 producto al 17,5 % sobre su costo."),
    ).toBeInTheDocument();
    // 9 × 1,175 = 10,575 → 10,58 (medio céntimo sube, como en `priceFromMarkup`).
    expect(
      within(dialog.getByRole("list", { name: "Precio y ganancia antes y después" })).getByRole(
        "listitem",
      ),
    ).toHaveTextContent(/ref 10\.00.*ref 10\.58/);
  });

  it("reports a mixed result row by row, keeps the failed ones selected and refreshes list and counter", async () => {
    const user = userEvent.setup({ delay: null });

    repriceResponse = () => {
      queue = [SAL];

      return jsonResponse({
        data: {
          failed: 1,
          results: [
            { productId: "p-arroz", salePriceRef: 11.7, status: "ok" },
            { productId: "p-harina", salePriceRef: 13, status: "ok" },
            {
              code: "NO_COST",
              message: "El producto no tiene costo.",
              productId: "p-sal",
              status: "error",
            },
          ],
          updated: 2,
        },
      });
    };
    renderPage("review=1");
    await findRow("Arroz");

    const listBefore = listRequests().length;
    const summaryBefore = requestsTo("/api/products/price-review/summary");

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar página" }));
    await user.click(screen.getByRole("button", { name: "Reprecio al 20 %" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.getByText("Sin costo: no se cambiará")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cambiar 3 precios" }));

    const result = within(await screen.findByRole("region", { name: "Resultado del reprecio" }));

    expect(result.getByText("2 precios actualizados")).toBeInTheDocument();
    expect(result.getByText("1 no se pudo cambiar:")).toBeInTheDocument();
    expect(result.getByRole("listitem")).toHaveTextContent("Sal · Sin costo");
    // Aviso con Toast, no con un diálogo nativo.
    expect(within(screen.getByRole("status")).getByText("2 precios actualizados")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("link", { name: "Arroz" })).not.toBeInTheDocument());
    expect(listRequests().length).toBeGreaterThan(listBefore);
    expect(requestsTo("/api/products/price-review/summary")).toBeGreaterThan(summaryBefore);
    await waitFor(() => expect(screen.getByTestId("price-review-count")).toHaveTextContent("1"));
    expect(screen.getByRole("checkbox", { name: "Seleccionar Sal" })).toBeChecked();
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
  });

  // PRO-F5: si el reprecio vacía la página y la lista salta a la anterior, el
  // resultado por fila no se pierde con el salto: sigue hasta que el usuario lo cierra.
  it("keeps the row by row result on screen when the reprice empties the page and the list jumps back", async () => {
    const user = userEvent.setup({ delay: null });
    const firstPage = Array.from({ length: 10 }, (_, index) =>
      product(`p-fill-${index}`, `Relleno ${index}`, 9, 10, review(8, 9, 10)),
    );
    let secondPage = [ARROZ];
    const serveDefault = fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const [path, query = ""] = String(input).split("?");

      if (path !== "/api/products" || init?.method === "POST") {
        return serveDefault?.(input, init);
      }

      const skip = Number(new URLSearchParams(query).get("skip") ?? 0);

      return jsonResponse({
        data: {
          items: skip >= 10 ? secondPage : firstPage,
          limit: 10,
          skip,
          total: firstPage.length + secondPage.length,
        },
      });
    });
    repriceResponse = () => {
      secondPage = [];

      return jsonResponse({
        data: {
          failed: 1,
          results: [
            {
              code: "NOT_FOUND",
              message: "Producto no encontrado.",
              productId: "p-arroz",
              status: "error",
            },
          ],
          updated: 0,
        },
      });
    };
    renderPage("review=1&page=2");
    await findRow("Arroz");

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Arroz" }));
    await user.click(screen.getByRole("button", { name: "Reprecio al 20 %" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar 1 precio" }),
    );

    // La página 2 quedó vacía: la lista vuelve a la 1.
    await findRow("Relleno 0");
    expect(window.location.search).not.toContain("page=2");

    const result = within(screen.getByRole("region", { name: "Resultado del reprecio" }));

    expect(result.getByText("Ningún precio actualizado")).toBeInTheDocument();
    // PRO-F6: Arroz ya salió de la lista; el resultado dice el motivo sin afirmar que sigue seleccionado.
    expect(result.getByText("1 no se pudo cambiar:")).toBeInTheDocument();
    expect(result.getByRole("listitem")).toHaveTextContent("Arroz · Producto no encontrado.");
    expect(screen.getByRole("region", { name: "Resultado del reprecio" })).not.toHaveTextContent(
      /seleccionad/,
    );
    expect(screen.getByText("0 seleccionados")).toBeInTheDocument();

    await user.click(result.getByRole("button", { name: "Cerrar el resultado del reprecio" }));

    expect(screen.queryByRole("region", { name: "Resultado del reprecio" })).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the server message when the whole reprice fails", async () => {
    const user = userEvent.setup({ delay: null });

    repriceResponse = () =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso para cambiar precios." } }, 403);
    renderPage("review=1");
    await findRow("Arroz");
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Arroz" }));
    await user.click(screen.getByRole("button", { name: "Reprecio al 12 %" }));
    await user.click(await screen.findByRole("button", { name: "Cambiar 1 precio" }));

    expect(
      await within(screen.getByRole("dialog")).findByText("No tienes permiso para cambiar precios."),
    ).toBeInTheDocument();
    // Detrás del diálogo la selección sigue intacta para reintentar.
    expect(
      screen.getByRole("checkbox", { hidden: true, name: "Seleccionar Arroz" }),
    ).toBeChecked();
  });

  it("keeps the price of one row from its actions menu, with an optional reason", async () => {
    const user = userEvent.setup({ delay: null });

    renderPage();

    const row = await findRow("Arroz");

    await user.click(within(row).getByRole("button", { name: "Abrir acciones" }));

    expect(screen.getByRole("menuitem", { name: "Cambiar precio" })).toHaveAttribute(
      "href",
      expect.stringContaining("/products/p-arroz"),
    );

    await user.click(screen.getByRole("menuitem", { name: "Mantener precio" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(
      dialog.getByText(
        "El precio no cambia: se queda en ref 10.00 con una ganancia de 11,11 %. Saldrá de la lista hasta que el costo vuelva a subir.",
      ),
    ).toBeInTheDocument();

    await user.type(dialog.getByLabelText("Motivo (opcional)"), "Precio de la competencia");

    const listBefore = listRequests().length;

    await user.click(dialog.getByRole("button", { name: "Mantener precio" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toEqual([
      {
        body: { expectedCostRef: 9, reason: "Precio de la competencia" },
        path: "/api/products/p-arroz/keep-price",
      },
    ]);
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(listBefore));
  });

  it("offers no price actions on rows that are not under review", async () => {
    const user = userEvent.setup({ delay: null });

    renderPage();
    await user.click(
      within(await findRow(LONG_NAME)).getByRole("button", { name: "Abrir acciones" }),
    );

    expect(screen.getByRole("menuitem", { name: "Ver detalle" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Mantener precio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cambiar precio" })).not.toBeInTheDocument();
  });

  it("shows the warning but no selection nor price actions without products.manage", async () => {
    const user = userEvent.setup({ delay: null });

    mockPermissions = ["products.view"];
    renderPage("review=1");

    const row = await findRow("Arroz");

    expect(within(row).getByText("Por revisar")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Reprecio/ })).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Abrir acciones" }));

    expect(screen.queryByRole("menuitem", { name: "Mantener precio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cambiar precio" })).not.toBeInTheDocument();
  });

  // PRO-F11: la fila que volvió como COST_CHANGED queda seleccionada y, ya con la
  // lista refrescada, el reintento sale del costo nuevo.
  it("retries a COST_CHANGED row with the refreshed cost", async () => {
    const user = userEvent.setup({ delay: null });
    const arrozWithNewCost = product("p-arroz", "Arroz", 12, 10, review(8, 12, 10));

    repriceResponse = () => {
      queue = [arrozWithNewCost];

      return jsonResponse({
        data: {
          failed: 1,
          results: [
            {
              code: "COST_CHANGED",
              message: "El costo cambió de 9.00 a 12.00; revisa el precio",
              productId: "p-arroz",
              status: "error",
            },
          ],
          updated: 0,
        },
      });
    };
    queue = [ARROZ];
    renderPage("review=1");

    await user.click(within(await findRow("Arroz")).getByRole("checkbox", { name: "Seleccionar Arroz" }));
    await user.click(screen.getByRole("button", { name: "Reprecio al 20 %" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar 1 precio" }),
    );

    const result = within(await screen.findByRole("region", { name: "Resultado del reprecio" }));

    expect(result.getByRole("listitem")).toHaveTextContent("Arroz · El costo cambió; vuelve a revisar");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Seleccionar Arroz" })).toBeChecked());

    await user.click(screen.getByRole("button", { name: "Reprecio al 20 %" }));

    const retry = within(await screen.findByRole("dialog"));

    // 12 × 1,20: la vista previa ya sale del costo nuevo.
    await waitFor(() => expect(retry.getByText("ref 14.40")).toBeInTheDocument());
    await user.click(retry.getByRole("button", { name: "Cambiar 1 precio" }));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.body).toEqual({
      items: [{ expectedCostRef: 12, productId: "p-arroz" }],
      markupPct: 20,
    });
  });
});
