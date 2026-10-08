/**
 * PRO-07 · lista de productos: semáforo de ganancia en todas las filas, filtro
 * y orden por ganancia, y todo el estado de la lista en la URL (regla 15).
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MARGIN_BADGE_TITLE } from "@/shared/components/MarginBadge";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("../product-details/components/ProductFormModal", () => ({
  ProductFormModal: () => null,
}));

import { ProductsListPage } from "./page";

type ProductRow = {
  categoryId: string;
  currentCostRef: number;
  currentStock: number;
  id: string;
  isActive: boolean;
  minStock: number;
  name: string;
  salePriceRef: number;
  sku: string;
};

function product(id: string, name: string, currentCostRef: number, salePriceRef: number): ProductRow {
  return {
    categoryId: "cat-1",
    currentCostRef,
    currentStock: 10,
    id,
    isActive: true,
    minStock: 2,
    name,
    salePriceRef,
    sku: id,
  };
}

const PRODUCTS = [
  product("p-baja", "Arroz", 10, 11), // 10 %
  product("p-media", "Harina", 10, 12), // 20 %
  product("p-alta", "Aceite", 10, 15), // 50 %
  product("p-perdida", "Azúcar", 10, 8), // −20 %
  product("p-sin-costo", "Sal", 0, 3),
];

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("ProductsListPage · ganancia y estado en la URL", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let productsResponse: () => Response;
  /** `GET /api/settings/pricing`: los ajustes de la tienda, o un 403. */
  let pricingResponse: () => Response;
  let isMobile = false;

  beforeEach(() => {
    isMobile = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: isMobile,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    window.history.replaceState(null, "", "/products");
    productsResponse = () =>
      jsonResponse({ data: { items: PRODUCTS, limit: 10, skip: 0, total: 45 } });
    pricingResponse = () =>
      jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      // Contador de "Por revisar" (PRO-11): otro endpoint, no es una consulta del listado.
      if (String(url).startsWith("/api/products/price-review/summary")) {
        return jsonResponse({ data: { total: 0 } });
      }

      if (String(url).startsWith("/api/products")) {
        return productsResponse();
      }

      if (String(url).startsWith("/api/settings/pricing")) {
        return pricingResponse();
      }

      if (String(url).startsWith("/api/categories")) {
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
        <ProductsListPage />
      </QueryClientProvider>,
    );
  }

  /** Parámetros de cada `GET /api/products` del listado, en orden. */
  function productRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/products")
      .map((url) => new URLSearchParams(url.split("?")[1] ?? ""));
  }

  function lastProductRequest() {
    const requests = productRequests();

    return Object.fromEntries(requests[requests.length - 1]);
  }

  async function findRow(name: string) {
    const link = await screen.findByRole("link", { name });
    const row = link.closest("tr");

    if (!row) {
      throw new Error(`Sin fila para ${name}`);
    }

    return row;
  }

  it("shows the margin badge on every row, also without cost and below cost", async () => {
    renderPage();

    const expected: [string, string, string | null][] = [
      ["Arroz", "10 %", "low"],
      ["Harina", "20 %", "mid"],
      ["Aceite", "50 %", "high"],
      ["Azúcar", "-20 %", "low"],
      ["Sal", "Sin costo", null],
    ];

    for (const [name, text, band] of expected) {
      const badges = within(await findRow(name)).getAllByTitle(MARGIN_BADGE_TITLE);

      // Columna "Ganancia" (lg) + badge junto al precio (por debajo de lg).
      expect(badges).toHaveLength(2);

      for (const badge of badges) {
        expect(badge).toHaveTextContent(text);
        expect(badge.getAttribute("data-band")).toBe(band);
      }
    }

    expect(screen.getByRole("columnheader", { name: /Ganancia/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Costo/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /PVP/ })).toBeInTheDocument();
  });

  it("paints the badge with the store thresholds: 20 % is green with green from 18 % (PRO-09)", async () => {
    pricingResponse = () =>
      jsonResponse({ data: { chipsPct: [10, 40], greenFromPct: 18, yellowFromPct: 8 } });
    renderPage();

    const expected: [string, string][] = [
      ["Arroz", "mid"], // 10 %
      ["Harina", "high"], // 20 %
      ["Aceite", "high"], // 50 %
      ["Azúcar", "low"], // −20 %
    ];

    for (const [name, band] of expected) {
      const row = await findRow(name);

      await waitFor(() => {
        for (const badge of within(row).getAllByTitle(MARGIN_BADGE_TITLE)) {
          expect(badge.getAttribute("data-band")).toBe(band);
        }
      });
    }

    // Una sola consulta de ajustes para toda la lista.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/settings/pricing")),
    ).toHaveLength(1);
  });

  it("falls back to the default thresholds when the store settings fail (PRO-09)", async () => {
    pricingResponse = () =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403);
    renderPage();

    const badges = within(await findRow("Harina")).getAllByTitle(MARGIN_BADGE_TITLE);

    expect(badges).toHaveLength(2);

    for (const badge of badges) {
      expect(badge).toHaveTextContent("20 %");
      expect(badge.getAttribute("data-band")).toBe("mid");
    }

    expect(await findRow("Aceite")).toBeInTheDocument();
  });

  it("uses the current defaults without URL parameters and writes nothing", async () => {
    renderPage();

    await findRow("Arroz");

    expect(lastProductRequest()).toEqual({
      limit: "10",
      skip: "0",
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(window.location.search).toBe("");
    expect(screen.getByLabelText("Ganancia")).toHaveValue("all");
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
  });

  it("offers the three bands and the products without cost in the margin filter", async () => {
    renderPage();

    const options = within(screen.getByLabelText("Ganancia")).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "Ganancia: Todas",
      "Baja",
      "Media",
      "Alta",
      "Sin costo",
    ]);
  });

  it("writes the margin filter in the URL and asks the server for that band", async () => {
    const user = userEvent.setup();

    renderPage("page=3");
    await findRow("Arroz");
    await user.selectOptions(screen.getByLabelText("Ganancia"), "Baja");

    // Cambiar un filtro vuelve a la página 1.
    expect(window.location.search).toBe("?margin=low");
    await waitFor(() => expect(lastProductRequest()).toMatchObject({ margin: "low", skip: "0" }));

    await user.selectOptions(screen.getByLabelText("Ganancia"), "Sin costo");

    expect(window.location.search).toBe("?margin=none");
    await waitFor(() => expect(lastProductRequest()).toMatchObject({ margin: "none" }));

    await user.selectOptions(screen.getByLabelText("Ganancia"), "Ganancia: Todas");

    expect(window.location.search).toBe("");
    await waitFor(() => expect(lastProductRequest()).not.toHaveProperty("margin"));
  });

  it("writes category and status in the URL", async () => {
    const user = userEvent.setup();

    renderPage();
    await findRow("Arroz");
    await user.selectOptions(await screen.findByLabelText("Categoría"), "Víveres");
    await user.selectOptions(screen.getByLabelText("Estado"), "Inactivo");

    expect(window.location.search).toBe("?category=cat-1&status=inactive");
    await waitFor(() =>
      expect(lastProductRequest()).toMatchObject({ categoryId: "cat-1", isActive: "false" }),
    );
  });

  it("sorts by margin percentage from the column header, both ways, in the URL", async () => {
    const user = userEvent.setup();

    renderPage();
    await findRow("Arroz");
    await user.click(screen.getByRole("button", { name: "Ganancia" }));

    expect(window.location.search).toBe("?sort=marginPct");
    await waitFor(() =>
      expect(lastProductRequest()).toMatchObject({ sortBy: "marginPct", sortOrder: "asc" }),
    );
    expect(screen.getByRole("columnheader", { name: /Ganancia/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await user.click(screen.getByRole("button", { name: "Ganancia" }));

    expect(window.location.search).toBe("?sort=marginPct&dir=desc");
    await waitFor(() =>
      expect(lastProductRequest()).toMatchObject({ sortBy: "marginPct", sortOrder: "desc" }),
    );
  });

  it("writes the search in the URL after the debounce and only then asks the server", async () => {
    renderPage();
    await findRow("Arroz");

    const requestsBefore = productRequests().length;

    fireEvent.change(screen.getByLabelText("Búsqueda"), { target: { value: "hari" } });
    fireEvent.change(screen.getByLabelText("Búsqueda"), { target: { value: "harina pan" } });

    // El campo refleja lo tecleado al instante; URL y consulta esperan.
    expect(screen.getByLabelText("Búsqueda")).toHaveValue("harina pan");
    expect(window.location.search).toBe("");
    expect(productRequests()).toHaveLength(requestsBefore);

    await waitFor(() => expect(window.location.search).toBe("?search=harina+pan"));
    await waitFor(() => expect(lastProductRequest()).toMatchObject({ search: "harina pan" }));
    expect(productRequests().some((request) => request.get("search") === "hari")).toBe(false);
  });

  it("restores search, filters, sort, page and page size from the URL on mount", async () => {
    renderPage(
      "search=arroz&category=cat-1&status=inactive&margin=mid&sort=marginPct&dir=desc&page=2&limit=20",
    );

    await findRow("Arroz");

    expect(productRequests()[0] && Object.fromEntries(productRequests()[0])).toEqual({
      categoryId: "cat-1",
      isActive: "false",
      limit: "20",
      margin: "mid",
      search: "arroz",
      skip: "20",
      sortBy: "marginPct",
      sortOrder: "desc",
    });
    expect(screen.getByLabelText("Búsqueda")).toHaveValue("arroz");
    expect(screen.getByLabelText("Estado")).toHaveValue("inactive");
    expect(screen.getByLabelText("Ganancia")).toHaveValue("mid");
    await waitFor(() => expect(screen.getByLabelText("Categoría")).toHaveValue("cat-1"));
    expect(screen.getByRole("columnheader", { name: /Ganancia/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("falls back to the defaults for invalid URL values and keeps foreign parameters", async () => {
    const user = userEvent.setup();

    renderPage("margin=verde&sort=precio&page=-3&review=si&tab=x");
    await findRow("Arroz");

    expect(lastProductRequest()).toEqual({
      limit: "10",
      skip: "0",
      sortBy: "name",
      sortOrder: "asc",
    });

    await user.selectOptions(screen.getByLabelText("Ganancia"), "Alta");

    // `review=si` no es un valor de "Por revisar" (PRO-11): no filtra. `tab` es ajeno y se conserva.
    expect(window.location.search).toBe("?tab=x&margin=high");
  });

  it("links every row to the detail with a real anchor carrying the exact list URL", async () => {
    renderPage("margin=low&sort=marginPct&dir=desc&page=2");

    const returnTo = encodeURIComponent("/products?margin=low&sort=marginPct&dir=desc&page=2");

    for (const row of PRODUCTS) {
      const link = await screen.findByRole("link", { name: row.name });

      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", `/products/${row.id}?returnTo=${returnTo}`);
    }
  });

  it("keeps the detail link in sync with the filters chosen after mounting", async () => {
    const user = userEvent.setup();

    renderPage();
    await findRow("Arroz");
    await user.selectOptions(screen.getByLabelText("Ganancia"), "Media");

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Arroz" })).toHaveAttribute(
        "href",
        `/products/p-baja?returnTo=${encodeURIComponent("/products?margin=mid")}`,
      ),
    );
  });

  it("moves page and page size through the URL", async () => {
    const user = userEvent.setup();

    renderPage();
    await findRow("Arroz");
    await user.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(window.location.search).toBe("?page=2");
    await waitFor(() => expect(lastProductRequest()).toMatchObject({ skip: "10" }));
  });

  it("shows the margin badge next to the price on the mobile cards", async () => {
    isMobile = true;
    renderPage();

    const link = await screen.findByRole("link", { name: "Aceite" });
    const card = link.closest("li");

    if (!card) {
      throw new Error("Sin tarjeta para Aceite");
    }

    const badge = within(card).getByTitle(MARGIN_BADGE_TITLE);

    expect(badge).toHaveTextContent("50 %");
    expect(badge.getAttribute("data-band")).toBe("high");
    // Mismo renglón que el precio (PVP).
    expect(badge.closest("dd")).toHaveTextContent("ref 15.00");
    expect(screen.getAllByTitle(MARGIN_BADGE_TITLE)).toHaveLength(PRODUCTS.length);
  });

  describe("PRO-F2", () => {
    /** Como el servidor: una página más allá del total llega vacía, con el total real. */
    function respondByPage(total: number) {
      fetchMock.mockImplementation(async (url: string) => {
        const [path, query = ""] = String(url).split("?");

        if (!path.startsWith("/api/products")) {
          return jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
        }

        const params = new URLSearchParams(query);
        const skip = Number(params.get("skip"));
        const limit = Number(params.get("limit"));

        return jsonResponse({
          data: { items: skip < total ? PRODUCTS : [], limit, skip, total },
        });
      });
    }

    it("keeps every column compact so the table fits a 940 px container at 1280 px", async () => {
      renderPage();

      const row = await findRow("Arroz");
      const headers = screen
        .getAllByRole("columnheader")
        .filter((header) => header.getAttribute("scope") === "col");
      const cells = Array.from(row.querySelectorAll("td")).slice(0, headers.length);

      expect(headers.map((header) => header.textContent)).toEqual([
        "SKU",
        "Nombre",
        "Categoría",
        "Costo",
        "PVP",
        "Ganancia",
        "Stock",
        "Estado",
      ]);

      for (const element of [...headers, ...cells]) {
        expect(element).toHaveClass("px-2");
        expect(element).not.toHaveClass("px-4");
      }

      // Anchos pensados con ese padding: SKU 84, Nombre ≥ 144, Costo y PVP ≥ 104.
      expect(headers[0]).toHaveClass("w-[5.25rem]", "pl-4");
      expect(cells[0]).toHaveClass("w-[5.25rem]", "pl-4");
      expect(cells[1]).toHaveClass("min-w-[9rem]");
      expect(cells[3]).toHaveClass("min-w-[6.5rem]");
      expect(cells[4]).toHaveClass("min-w-[6.5rem]");
      expect(row.querySelector('[class*="min-w-[7.5rem]"], [class*="min-w-[10rem]"]')).toBeNull();
    });

    it("clamps a page beyond the total to the last page, in the URL and in the request", async () => {
      respondByPage(33);
      renderPage("margin=low&page=9999");

      await waitFor(() => expect(window.location.search).toBe("?margin=low&page=4"));
      await waitFor(() => expect(lastProductRequest()).toMatchObject({ margin: "low", skip: "30" }));
      expect(await screen.findByText(/Mostrando 31/)).toHaveTextContent("33");
      expect(screen.queryByText(/99981/)).not.toBeInTheDocument();
    });

    it("clamps to the first page when the filter leaves no products", async () => {
      respondByPage(0);
      renderPage("margin=high&page=7");

      await waitFor(() => expect(window.location.search).toBe("?margin=high"));
      expect(await screen.findByText("No hay productos para mostrar")).toBeInTheDocument();
    });

    it("leaves a valid last page alone", async () => {
      respondByPage(33);
      renderPage("page=4");

      await findRow("Arroz");

      expect(window.location.search).toBe("?page=4");
      expect(productRequests()).toHaveLength(1);
    });

    it("offers a sort selector below lg that writes sort and dir in the URL", async () => {
      const user = userEvent.setup();

      renderPage("page=3");
      await findRow("Arroz");

      const select = screen.getByLabelText("Orden");

      // Desde lg ordenan las cabeceras de la tabla: el selector es para tarjetas y tabla sin "Ganancia".
      expect(select.parentElement).toHaveClass("lg:hidden");
      expect(select).toHaveValue("name:asc");
      expect(
        within(select).getByRole("option", { name: "Ganancia: menor a mayor" }),
      ).toBeInTheDocument();

      await user.selectOptions(select, "Ganancia: mayor a menor");

      // Cambiar el orden vuelve a la página 1.
      expect(window.location.search).toBe("?sort=marginPct&dir=desc");
      await waitFor(() =>
        expect(lastProductRequest()).toMatchObject({
          skip: "0",
          sortBy: "marginPct",
          sortOrder: "desc",
        }),
      );

      await user.selectOptions(select, "Ganancia: menor a mayor");

      expect(window.location.search).toBe("?sort=marginPct");

      await user.selectOptions(select, "Nombre: A a Z");

      expect(window.location.search).toBe("");
    });

    it("shows in the sort selector the order that came in the URL or from a header", async () => {
      const user = userEvent.setup();

      renderPage("sort=sku&dir=desc");
      await findRow("Arroz");

      expect(screen.getByLabelText("Orden")).toHaveValue("sku:desc");

      await user.click(screen.getByRole("button", { name: "Stock" }));

      expect(screen.getByLabelText("Orden")).toHaveValue("currentStock:asc");
    });

    it("shows the sort selector on the mobile cards", async () => {
      isMobile = true;
      renderPage("sort=marginPct&dir=desc");

      await screen.findByRole("link", { name: "Aceite" });

      expect(screen.getByLabelText("Orden")).toHaveValue("marginPct:desc");
    });
  });

  describe("PRO-F12 · página de la URL más allá del total", () => {
    /** El servidor desde PRO-F12: más allá del total responde 200 vacío con el total real. */
    function respondWithTotal(total: number) {
      const otherRequests = fetchMock.getMockImplementation();

      fetchMock.mockImplementation(async (url: string) => {
        const [path, query = ""] = String(url).split("?");

        if (path !== "/api/products") {
          return otherRequests?.(url);
        }

        const params = new URLSearchParams(query);
        const skip = Number(params.get("skip"));
        const limit = Number(params.get("limit"));

        return jsonResponse({
          data: { items: skip < total ? PRODUCTS : [], limit, skip, total },
        });
      });
    }

    /** Deja pasar efectos y peticiones pendientes: si hubiera un bucle, aparecerían aquí. */
    async function settle() {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    it("recargar la última página cuando el total bajó vuelve a la última que existe, sin bucle", async () => {
      respondWithTotal(49);
      renderPage("category=cat-1&page=6");

      await waitFor(() => expect(window.location.search).toBe("?category=cat-1&page=5"));
      expect(await screen.findByText(/Mostrando 41/)).toHaveTextContent("49");
      expect(screen.queryByText("No pudimos cargar los datos")).not.toBeInTheDocument();

      await settle();

      // La página pedida (vacía) y la última válida: ni una petición más.
      expect(productRequests().map((params) => params.get("skip"))).toEqual(["50", "40"]);
      expect(window.location.search).toBe("?category=cat-1&page=5");
    });

    it("con total 0 vuelve a la página 1 y muestra el estado vacío, sin bucle", async () => {
      respondWithTotal(0);
      renderPage("review=1&page=999");

      await waitFor(() => expect(window.location.search).toBe("?review=1"));
      expect(await screen.findByText("Ningún producto bajó de ganancia")).toBeInTheDocument();
      expect(screen.queryByText("No pudimos cargar los datos")).not.toBeInTheDocument();

      await settle();

      expect(productRequests().map((params) => params.get("skip"))).toEqual(["9980", "0"]);
      expect(window.location.search).toBe("?review=1");
    });

    it("si la lista falla con parámetros en la URL ofrece restablecer los filtros", async () => {
      const user = userEvent.setup();

      const otherRequests = fetchMock.getMockImplementation();

      fetchMock.mockImplementation(async (url: string) => {
        const [path, query = ""] = String(url).split("?");

        if (path !== "/api/products") {
          return otherRequests?.(url);
        }

        return new URLSearchParams(query).get("skip") === "0"
          ? jsonResponse({ data: { items: PRODUCTS, limit: 10, skip: 0, total: 5 } })
          : jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Falló el listado." } }, 500);
      });
      renderPage("margin=low&page=7");

      expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Restablecer filtros" }));

      expect(window.location.search).toBe("");
      await findRow("Arroz");
      expect(screen.queryByRole("button", { name: "Restablecer filtros" })).not.toBeInTheDocument();
    });

    it("sin parámetros en la URL el error solo ofrece reintentar", async () => {
      productsResponse = () =>
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Falló el listado." } }, 500);
      renderPage();

      expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Restablecer filtros" })).not.toBeInTheDocument();
    });
  });

  it("shows the empty state when the filter leaves no products", async () => {
    productsResponse = () => jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    renderPage("margin=high");

    expect(await screen.findByText("No hay productos para mostrar")).toBeInTheDocument();
    expect(screen.getByLabelText("Ganancia")).toHaveValue("high");
  });

  it("shows the error state with retry when the list fails", async () => {
    productsResponse = () =>
      jsonResponse({ error: { code: "INTERNAL", message: "Falló el listado." } }, 500);
    renderPage();

    expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();
    expect(screen.getByText("Falló el listado.")).toBeInTheDocument();
  });
});
