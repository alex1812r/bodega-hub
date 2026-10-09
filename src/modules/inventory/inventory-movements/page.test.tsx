/**
 * INV-04b · `/inventory/movements`: filtros aplicados por el servidor y
 * guardados en la URL (regla 15), producto con búsqueda en servidor, documento
 * de cada movimiento, `returnTo`, paginación y exportación con los mismos filtros.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

import type { InventoryMovement } from "../hooks/useInventory";

const mockExportMovementsToExcel = jest.fn();
const mockAdjustmentModal = jest.fn();
const mockPackConversionModal = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/inventory/movements",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("./components/InventoryAdjustmentModal", () => ({
  InventoryAdjustmentModal: (props: unknown) => {
    mockAdjustmentModal(props);

    return null;
  },
}));
jest.mock("./components/InventoryPackConversionModal", () => ({
  InventoryPackConversionModal: (props: unknown) => {
    mockPackConversionModal(props);

    return null;
  },
}));
jest.mock("./services/exportMovementsExcel", () => ({
  exportMovementsToExcel: (...args: unknown[]) => mockExportMovementsToExcel(...args),
}));

import { InventoryMovementsPage } from "./page";

function product(id: string, name: string) {
  return {
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 20,
    id,
    isActive: true,
    minStock: 5,
    name,
    salePriceRef: 2,
    sku: id.toUpperCase(),
  };
}

const CATALOG = [product("p-harina", "Harina"), product("p-arroz", "Arroz")];

function movement(id: string, overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    createdAt: "2026-10-05T16:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id,
    product: CATALOG[0],
    productId: "p-harina",
    quantityDelta: 5,
    stockAfter: 25,
    type: "ajuste_entrada",
    ...overrides,
  };
}

const MOVEMENTS: InventoryMovement[] = [
  movement("mov-venta", {
    documentKind: "venta",
    documentNumber: "V-0001",
    quantityDelta: -2,
    reason: "Venta en caja",
    saleId: "sale-1",
    stockAfter: 18,
    type: "venta",
  }),
  movement("mov-compra", {
    documentKind: "compra",
    documentNumber: "C-0007",
    purchaseId: "purchase-7",
    quantityDelta: 12,
    stockAfter: 20,
    type: "compra",
  }),
  movement("mov-conversion", {
    conversionId: "conv-1",
    documentKind: "conversion",
    quantityDelta: 24,
    stockAfter: 8,
    type: "conversion_entrada",
  }),
  movement("mov-ajuste", { reason: "Conteo físico" }),
  movement("mov-negativo", {
    product: CATALOG[1],
    productId: "p-arroz",
    quantityDelta: -6,
    stockAfter: -4,
    type: "ajuste_salida",
  }),
  // La base no devolvió el documento: se muestra el tipo, no "Ajuste manual".
  movement("mov-compra-sin-numero", {
    documentKind: "compra",
    purchaseId: "purchase-9",
    quantityDelta: 3,
    stockAfter: 7,
    type: "compra",
  }),
];

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function page(items: InventoryMovement[], total = items.length, limit = 10, skip = 0) {
  return jsonResponse({ data: { items, limit, skip, total } });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message } }, status);
}

describe("InventoryMovementsPage · filtros en servidor y en la URL", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  /** Respuesta de `GET /api/inventory/movements` según los parámetros pedidos. */
  let movementsResponse: (params: URLSearchParams) => Response | Promise<Response>;
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
    window.localStorage.clear();
    window.history.replaceState(null, "", "/inventory/movements");
    movementsResponse = () => page(MOVEMENTS, 45);
    mockExportMovementsToExcel.mockReset();
    mockExportMovementsToExcel.mockResolvedValue(undefined);
    mockAdjustmentModal.mockReset();
    mockPackConversionModal.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const [path, query = ""] = String(url).split("?");
      const params = new URLSearchParams(query);

      if (path === "/api/inventory/movements") {
        return movementsResponse(params);
      }

      if (path === "/api/products") {
        const search = (params.get("search") ?? "").toLowerCase();
        const items = CATALOG.filter((item) => item.name.toLowerCase().includes(search));

        return jsonResponse({
          data: { items, limit: Number(params.get("limit")), skip: 0, total: items.length },
        });
      }

      const found = CATALOG.find((item) => path === `/api/products/${item.id}`);

      return found
        ? jsonResponse({ data: found })
        : errorResponse(404, "NOT_FOUND", "Producto no encontrado.");
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
    window.history.replaceState(
      null,
      "",
      query ? `/inventory/movements?${query}` : "/inventory/movements",
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <InventoryMovementsPage />
      </QueryClientProvider>,
    );
  }

  function requestedPaths() {
    return fetchMock.mock.calls.map(([url]) => String(url).split("?")[0]);
  }

  /** Parámetros de cada `GET /api/inventory/movements`, en orden. */
  function movementRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/inventory/movements")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastMovementRequest() {
    const requests = movementRequests();

    return requests[requests.length - 1];
  }

  /** Fila de la tabla que contiene `text` (documento o motivo). */
  async function findRowWith(text: string) {
    const row = (await screen.findByText(text)).closest("tr");

    if (!row) {
      throw new Error(`Sin fila para ${text}`);
    }

    return row;
  }

  function productField() {
    return screen.getByRole<HTMLInputElement>("combobox", { name: "Producto" });
  }

  describe("estado en la URL", () => {
    it("asks for the first page without filters when the URL has no parameters, and writes nothing", async () => {
      renderPage();

      await findRowWith("V-0001");

      expect(movementRequests()).toEqual([{ limit: "10", skip: "0" }]);
      expect(window.location.search).toBe("");
      expect(screen.getByLabelText("Tipo de movimiento")).toHaveValue("");
      expect(screen.getByLabelText("Tipo de documento")).toHaveValue("");
      expect(screen.getByLabelText("Número de documento")).toHaveValue("");
      expect(screen.getByLabelText("Desde")).toHaveValue("");
      expect(screen.getByLabelText("Hasta")).toHaveValue("");
      expect(productField()).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("honours every parameter of the URL on mount and sends all of them to the server", async () => {
      renderPage(
        "type=venta&from=2026-10-01&to=2026-10-05&productId=p-harina&document=V-00&documentKind=venta&page=2&limit=20",
      );

      await findRowWith("V-0001");

      expect(movementRequests()).toEqual([
        {
          document: "V-00",
          documentKind: "venta",
          from: "2026-10-01",
          limit: "20",
          productId: "p-harina",
          skip: "20",
          to: "2026-10-05",
          type: "venta",
        },
      ]);
      expect(screen.getByLabelText("Tipo de movimiento")).toHaveValue("venta");
      expect(screen.getByLabelText("Tipo de documento")).toHaveValue("venta");
      expect(screen.getByLabelText("Número de documento")).toHaveValue("V-00");
      expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-01");
      expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-05");
    });

    it("falls back to the default of an invalid parameter without losing the valid ones", async () => {
      renderPage("type=robo&from=ayer&documentKind=factura&page=-2&to=2026-10-05");

      await findRowWith("V-0001");

      expect(lastMovementRequest()).toEqual({ limit: "10", skip: "0", to: "2026-10-05" });
    });

    it.each([
      ["Tipo de movimiento", "Compra", "type", "compra"],
      ["Tipo de documento", "Ajuste manual", "documentKind", "sin_documento"],
      ["Tipo de documento", "Conversión", "documentKind", "conversion"],
    ])(
      "writes %s = %s in the URL, asks the server for it and goes back to page 1",
      async (label, option, param, value) => {
        const user = userEvent.setup();

        renderPage("page=3");
        await findRowWith("V-0001");
        expect(lastMovementRequest()).toEqual({ limit: "10", skip: "20" });

        await user.selectOptions(screen.getByLabelText(label), option);

        expect(window.location.search).toBe(`?${param}=${value}`);
        await waitFor(() =>
          expect(lastMovementRequest()).toEqual({ limit: "10", skip: "0", [param]: value }),
        );
      },
    );

    it("writes the date range in the URL, asks the server for it and goes back to page 1", async () => {
      renderPage("page=3");
      await findRowWith("V-0001");

      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });

      expect(window.location.search).toBe("?from=2026-10-01");
      await waitFor(() =>
        expect(lastMovementRequest()).toEqual({ from: "2026-10-01", limit: "10", skip: "0" }),
      );

      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-05" } });

      expect(window.location.search).toBe("?from=2026-10-01&to=2026-10-05");
      await waitFor(() =>
        expect(lastMovementRequest()).toEqual({
          from: "2026-10-01",
          limit: "10",
          skip: "0",
          to: "2026-10-05",
        }),
      );
    });

    it("sends the document text after the debounce only from 3 characters, and goes back to page 1", async () => {
      const user = userEvent.setup();

      renderPage("page=3");
      await findRowWith("V-0001");

      await user.type(screen.getByLabelText("Número de documento"), "V-");

      expect(screen.getByText("Escribe al menos 3 caracteres")).toBeInTheDocument();
      await waitFor(() => expect(window.location.search).toBe("?document=V-"));
      await waitFor(() => expect(lastMovementRequest()).toEqual({ limit: "10", skip: "0" }));

      await user.type(screen.getByLabelText("Número de documento"), "00");

      expect(screen.queryByText("Escribe al menos 3 caracteres")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(lastMovementRequest()).toEqual({ document: "V-00", limit: "10", skip: "0" }),
      );
      expect(window.location.search).toBe("?document=V-00");
      expect(movementRequests().some((request) => request.document === "V-")).toBe(false);
    });

    it("clears every filter with 'Limpiar filtros' and keeps returnTo", async () => {
      const user = userEvent.setup();

      renderPage(
        "type=venta&from=2026-10-01&productId=p-harina&documentKind=venta&returnTo=%2Finventory",
      );
      await findRowWith("V-0001");

      await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

      expect(window.location.search).toBe("?returnTo=%2Finventory");
      await waitFor(() => expect(lastMovementRequest()).toEqual({ limit: "10", skip: "0" }));
      expect(productField()).toHaveValue("");
    });
  });

  describe("rango de fechas invertido", () => {
    it("warns next to the dates and neither queries nor exports until it is fixed", async () => {
      renderPage("from=2026-10-05&to=2026-10-01");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "La fecha inicial no puede ser posterior a la final.",
      );
      expect(screen.getByLabelText("Desde")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Hasta")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Revisa el rango de fechas")).toBeInTheDocument();
      expect(screen.queryByText("No pudimos cargar los datos")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeDisabled();
      expect(movementRequests()).toEqual([]);

      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-09" } });

      await findRowWith("V-0001");
      expect(movementRequests()).toEqual([
        { from: "2026-10-05", limit: "10", skip: "0", to: "2026-10-09" },
      ]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeEnabled();
    });

    it("stops querying when a valid range becomes inverted", async () => {
      renderPage("from=2026-10-01&to=2026-10-05");
      await findRowWith("V-0001");

      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-20" } });

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText("V-0001")).not.toBeInTheDocument();
      expect(movementRequests()).toHaveLength(1);
    });
  });

  describe("filtro de producto", () => {
    it("searches products on the server while typing, without loading the catalogue", async () => {
      const user = userEvent.setup();

      renderPage("page=2");
      await findRowWith("V-0001");

      expect(requestedPaths()).toEqual(["/api/inventory/movements"]);

      await user.type(productField(), "har");
      await user.click(await screen.findByRole("option", { name: /Harina/ }));

      const productSearches = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.startsWith("/api/products?"));

      expect(productSearches.length).toBeGreaterThan(0);
      expect(
        productSearches.every((url) => new URLSearchParams(url.split("?")[1]).has("search")),
      ).toBe(true);
      expect(window.location.search).toBe("?productId=p-harina");
      await waitFor(() =>
        expect(lastMovementRequest()).toEqual({ limit: "10", productId: "p-harina", skip: "0" }),
      );
      expect(productField()).toHaveValue("Harina (P-HARINA)");
      // Lo elegido ya trae su nombre: no se vuelve a leer por id.
      expect(requestedPaths()).not.toContain("/api/products/p-harina");
      expect(requestedPaths()).not.toContain("/api/inventory");
    });

    it("shows the name of the product that comes in the URL with a single read by id", async () => {
      renderPage("productId=p-arroz");

      await waitFor(() => expect(productField()).toHaveValue("Arroz (P-ARROZ)"));
      await findRowWith("V-0001");

      expect(requestedPaths().filter((path) => path.startsWith("/api/products"))).toEqual([
        "/api/products/p-arroz",
      ]);
      expect(lastMovementRequest()).toEqual({ limit: "10", productId: "p-arroz", skip: "0" });
    });

    it("lets the product be removed", async () => {
      const user = userEvent.setup();

      renderPage("productId=p-arroz&page=2");
      await waitFor(() => expect(productField()).toHaveValue("Arroz (P-ARROZ)"));

      await user.click(screen.getByRole("button", { name: "Limpiar Producto" }));

      expect(window.location.search).toBe("");
      await waitFor(() => expect(lastMovementRequest()).toEqual({ limit: "10", skip: "0" }));
      expect(productField()).toHaveValue("");
    });

    it("says so when the product of the URL cannot be read, and still filters by it", async () => {
      renderPage("productId=p-borrado");

      await findRowWith("V-0001");

      await waitFor(() => expect(productField()).toHaveValue("Producto no disponible"));
      expect(screen.getByText("Producto no encontrado.")).toBeInTheDocument();
      expect(lastMovementRequest()).toEqual({ limit: "10", productId: "p-borrado", skip: "0" });
    });

    it("hands the product of the filter to the adjustment and pack conversion modals", async () => {
      renderPage("productId=p-arroz");
      await findRowWith("V-0001");

      expect(mockAdjustmentModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ defaultProductId: "p-arroz" }),
      );
      expect(mockPackConversionModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ defaultPackProductId: "p-arroz" }),
      );
    });

    it("gives the modals no product when there is no filter", async () => {
      renderPage();
      await findRowWith("V-0001");

      expect(mockAdjustmentModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ defaultProductId: undefined }),
      );
      expect(mockPackConversionModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ defaultPackProductId: undefined }),
      );
    });
  });

  describe("tabla", () => {
    it("shows the document and the balance columns", async () => {
      renderPage();
      await findRowWith("V-0001");

      for (const header of ["Fecha", "Producto", "Tipo", "Cant.", "Saldo", "Documento"]) {
        expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
      }

      expect(within(await findRowWith("V-0001")).getByText("18")).toBeInTheDocument();
    });

    it("links the document number to the sale or purchase, with returnTo = the current URL", async () => {
      renderPage("type=venta&page=2");
      await findRowWith("V-0001");

      const listUrl = encodeURIComponent("/inventory/movements?type=venta&page=2");

      expect(screen.getByRole("link", { name: "V-0001" })).toHaveAttribute(
        "href",
        `/sales/sale-1?returnTo=${listUrl}`,
      );
      expect(screen.getByRole("link", { name: "C-0007" })).toHaveAttribute(
        "href",
        `/purchases/purchase-7?returnTo=${listUrl}`,
      );
    });

    it("chains the returnTo of the list into the document link (INV-F3)", async () => {
      renderPage("returnTo=%2Finventory%3Fsearch%3Dharina");
      await findRowWith("V-0001");

      const href = screen.getByRole("link", { name: "V-0001" }).getAttribute("href");
      const listUrl = new URLSearchParams(href?.split("?")[1]).get("returnTo");

      expect(href?.split("?")[0]).toBe("/sales/sale-1");
      expect(listUrl?.split("?")[0]).toBe("/inventory/movements");
      expect(new URLSearchParams(listUrl?.split("?")[1]).get("returnTo")).toBe(
        "/inventory?search=harina",
      );
    });

    it("says 'Conversión de empaque' for a conversion and 'Ajuste manual' without a document", async () => {
      renderPage();

      const conversionRow = (await screen.findByText("Conversión de empaque")).closest("tr");
      const manualRow = await findRowWith("Conteo físico");

      expect(conversionRow).not.toBeNull();
      expect(within(manualRow).getByText("Ajuste manual")).toBeInTheDocument();
      expect(within(manualRow).queryByRole("link")).not.toBeInTheDocument();
      // 2 en la tabla (mov-ajuste, mov-negativo) + la opción del filtro.
      expect(screen.getAllByText("Ajuste manual")).toHaveLength(3);
    });

    it("shows the document type, not 'Ajuste manual', when a purchase comes without its number", async () => {
      renderPage();
      await findRowWith("V-0001");

      expect(screen.getByRole("link", { name: "Compra" })).toHaveAttribute(
        "href",
        `/purchases/purchase-9?returnTo=${encodeURIComponent("/inventory/movements")}`,
      );
    });

    it("shows a historical negative balance as it is, highlighted with the error token", async () => {
      renderPage();
      await findRowWith("V-0001");

      const negative = screen.getByText("-4");

      expect(negative).toHaveAttribute("data-negative", "true");
      expect(negative).toHaveClass("text-error");
      expect(within(await findRowWith("V-0001")).getByText("18")).not.toHaveClass("text-error");
    });

    it("shows every figure in stacked cards on a phone", async () => {
      isMobile = true;
      renderPage();

      const card = (await screen.findByText("V-0001")).closest("li");

      if (!card) {
        throw new Error("Sin tarjeta para V-0001");
      }

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(
        within(card)
          .getAllByRole("term")
          .map((term) => term.textContent),
      ).toEqual(["Fecha", "Producto", "Tipo", "Cant.", "Saldo", "Documento", "Motivo"]);
      expect(within(card).getByRole("link", { name: "V-0001" })).toBeInTheDocument();
    });
  });

  describe("volver", () => {
    it("goes back to returnTo when the URL brings it, and keeps it when a filter changes", async () => {
      const user = userEvent.setup();

      renderPage("returnTo=%2Finventory%3Fsearch%3Dharina%26page%3D2");
      await findRowWith("V-0001");

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
        "href",
        "/inventory?search=harina&page=2",
      );

      await user.selectOptions(screen.getByLabelText("Tipo de movimiento"), "Venta");

      expect(window.location.search).toBe(
        "?returnTo=%2Finventory%3Fsearch%3Dharina%26page%3D2&type=venta",
      );
      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
        "href",
        "/inventory?search=harina&page=2",
      );
    });

    it("goes back to the product detail it came from", async () => {
      renderPage("productId=p-arroz&returnTo=%2Fproducts%2Fp-arroz");
      await findRowWith("V-0001");

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
        "href",
        "/products/p-arroz",
      );
    });

    it("goes back to the inventory list with the returnTo that list arrived with (INV-F1)", async () => {
      const listUrl = `/inventory?product=p-arroz&returnTo=${encodeURIComponent("/products?search=arr&page=2")}`;

      renderPage(`productId=p-arroz&returnTo=${encodeURIComponent(listUrl)}`);
      await findRowWith("V-0001");

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", listUrl);
    });

    it.each(["", "returnTo=%2F%2Fevil.com", "returnTo=https%3A%2F%2Fevil.com"])(
      "keeps 'Volver a Inventario' without a safe returnTo (%s)",
      async (query) => {
        renderPage(query);
        await findRowWith("V-0001");

        expect(screen.getByRole("link", { name: "Volver a Inventario" })).toHaveAttribute(
          "href",
          "/inventory",
        );
        expect(screen.queryByRole("link", { name: "Volver" })).not.toBeInTheDocument();
      },
    );
  });

  describe("paginación", () => {
    it("asks the server for the page and the page size of the URL", async () => {
      renderPage("page=3&limit=20");
      await findRowWith("V-0001");

      expect(movementRequests()).toEqual([{ limit: "20", skip: "40" }]);
    });

    it("goes back to the last valid page when the URL asks for one past the total", async () => {
      movementsResponse = (params) => {
        const skip = Number(params.get("skip"));

        return skip >= 25 ? page([], 25, 10, skip) : page(MOVEMENTS, 25, 10, skip);
      };
      renderPage("type=venta&page=9");

      await findRowWith("V-0001");

      expect(window.location.search).toBe("?type=venta&page=3");
      expect(movementRequests()).toEqual([
        { limit: "10", skip: "80", type: "venta" },
        { limit: "10", skip: "20", type: "venta" },
      ]);
      expect(
        screen.queryByText("Ningún movimiento coincide con los filtros"),
      ).not.toBeInTheDocument();
    });
  });

  describe("estados", () => {
    it("shows the skeleton while the first page loads", async () => {
      let release: (response: Response) => void = () => undefined;

      movementsResponse = () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        });
      renderPage();

      await waitFor(() => expect(movementRequests()).toHaveLength(1));
      expect(screen.queryByText("Aún no hay movimientos de inventario")).not.toBeInTheDocument();
      expect(screen.queryByText("V-0001")).not.toBeInTheDocument();

      release(page(MOVEMENTS));

      await findRowWith("V-0001");
    });

    it("explains the empty list when there are no filters", async () => {
      movementsResponse = () => page([], 0);
      renderPage();

      expect(await screen.findByText("Aún no hay movimientos de inventario")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("offers 'Limpiar filtros' when no movement matches the filters", async () => {
      const user = userEvent.setup();

      movementsResponse = (params) => (params.has("type") ? page([], 0) : page(MOVEMENTS));
      renderPage("type=inventario_inicial");

      const empty = (
        await screen.findByText("Ningún movimiento coincide con los filtros")
      ).closest("div");

      if (!empty) {
        throw new Error("Sin estado vacío");
      }

      await user.click(within(empty).getByRole("button", { name: "Limpiar filtros" }));

      expect(window.location.search).toBe("");
      await findRowWith("V-0001");
    });

    it("shows the server error with a retry that asks again", async () => {
      const user = userEvent.setup();
      let fails = true;

      movementsResponse = () =>
        fails
          ? errorResponse(500, "INTERNAL", "No pudimos consultar los movimientos.")
          : page(MOVEMENTS);
      renderPage();

      expect(await screen.findByText("No pudimos cargar los datos")).toBeInTheDocument();
      expect(screen.getByText("No pudimos consultar los movimientos.")).toBeInTheDocument();

      fails = false;
      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      await findRowWith("V-0001");
      expect(movementRequests()).toHaveLength(2);
    });

    it("tells a user without permission so, without filters, actions or a retry", async () => {
      movementsResponse = () => errorResponse(403, "FORBIDDEN", "No tienes permiso.");
      renderPage();

      expect(
        await screen.findByText("No tienes permiso para ver los movimientos de inventario"),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Tipo de movimiento")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Exportar Excel" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Volver a Inventario" })).toBeInTheDocument();
    });
  });

  describe("exportación", () => {
    it("exports with exactly the filters of the URL", async () => {
      const user = userEvent.setup();

      renderPage(
        "type=venta&from=2026-10-01&to=2026-10-05&productId=p-harina&document=V-00&documentKind=venta&page=2",
      );
      await findRowWith("V-0001");

      await user.click(screen.getByRole("button", { name: "Exportar Excel" }));

      expect(mockExportMovementsToExcel).toHaveBeenCalledTimes(1);
      expect(mockExportMovementsToExcel).toHaveBeenCalledWith({
        document: "V-00",
        documentKind: "venta",
        from: "2026-10-01",
        productId: "p-harina",
        to: "2026-10-05",
        type: "venta",
      });
    });

    it("exports without the document text while it is shorter than 3 characters", async () => {
      const user = userEvent.setup();

      renderPage("document=V-&documentKind=sin_documento");
      await findRowWith("V-0001");

      await user.click(screen.getByRole("button", { name: "Exportar Excel" }));

      expect(mockExportMovementsToExcel).toHaveBeenCalledWith({
        document: undefined,
        documentKind: "sin_documento",
        from: undefined,
        productId: undefined,
        to: undefined,
        type: undefined,
      });
    });
  });

  describe("DET-06d · volver y scroll", () => {
    /** Posición guardada para `url` y espía del `scrollTo` de la ventana (sin `<main>`, hace scroll ella). */
    function rememberScroll(url: string, top: number) {
      const scrollTo = jest.fn();

      Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
      window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify([[url, top]]));

      return scrollTo;
    }

    afterEach(() => {
      window.sessionStorage.clear();
    });

    it("restores the scroll saved for this exact URL once the rows are painted", async () => {
      const scrollTo = rememberScroll("/inventory/movements?type=venta&from=2026-10-01", 640);

      renderPage("type=venta&from=2026-10-01");

      expect(scrollTo).not.toHaveBeenCalled();

      await findRowWith("V-0001");

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 640);
    });

    it("does not move the scroll on a URL without a saved position", async () => {
      const scrollTo = rememberScroll("/inventory/movements?type=venta&from=2026-10-01", 640);

      renderPage("type=venta");
      await findRowWith("V-0001");

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("'Volver' with a returnTo announces its shortcuts; 'Volver a Inventario' has none", async () => {
      const view = renderPage("returnTo=%2Finventory%3Fsearch%3Dharina");

      await findRowWith("V-0001");

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
        "aria-keyshortcuts",
        "Escape Alt+ArrowLeft",
      );

      view.unmount();
      renderPage();
      await findRowWith("V-0001");

      expect(screen.getByRole("link", { name: "Volver a Inventario" })).not.toHaveAttribute(
        "aria-keyshortcuts",
      );
    });

    it("writes the type filter in the URL and goes back to page 1", async () => {
      const user = userEvent.setup();

      renderPage("page=3");
      await findRowWith("V-0001");
      await user.selectOptions(screen.getByLabelText("Tipo de movimiento"), "Venta");

      expect(window.location.search).toBe("?type=venta");
      await waitFor(() =>
        expect(lastMovementRequest()).toEqual({ limit: "10", skip: "0", type: "venta" }),
      );
    });
  });
});
