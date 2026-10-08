/**
 * INV-05 · selección de productos por reponer: lista paginada desde el
 * servidor, cantidad sugerida editable, proveedor por producto, resumen por
 * proveedor y precarga de `/purchases/create?restock=<id>`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = jest.fn();
const mockPermission = {
  can: (permission: string) => permission.length > 0,
  isLoading: false,
  profile: { storeId: "store-1", user: { id: "user-1" } } as
    | { storeId: string | null; user: { id: string } }
    | undefined,
};

jest.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => mockPermission,
}));

import type { InventoryOverviewItem } from "../services/inventoryOverview";
import { RESTOCK_QUERY_PARAM, readRestockDraft } from "./restockDraft";
import type { RestockSupplierLink } from "./restockPlan";
import { RestockSelection } from "./RestockSelection";

const SESSION = { storeId: "store-1", userId: "user-1" };
const CREATE = "Crear compra con estos productos";

function item(
  id: string,
  name: string,
  currentStock: number,
  minStock: number,
): InventoryOverviewItem {
  return {
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock,
    entries30d: 0,
    exits30d: 0,
    id,
    isActive: true,
    lastMovementAt: null,
    lastMovementType: null,
    minStock,
    name,
    salePriceRef: 2,
    sku: id.toUpperCase(),
    stockStatus: currentStock === 0 ? "out" : "low",
  };
}

function link(
  supplierId: string,
  name: string,
  overrides: Partial<RestockSupplierLink> = {},
): RestockSupplierLink {
  return {
    isActive: true,
    isPreferred: false,
    lastCostRef: 0,
    supplier: { id: supplierId, isActive: true, name },
    supplierId,
    ...overrides,
  };
}

const ARROZ = item("p-arroz", "Arroz", 2, 5); // sugerida 8
const ACEITE = item("p-aceite", "Aceite", -3, 5); // sugerida 13
const SAL = item("p-sal", "Sal", 0, 0); // sugerida 1
const CAFE = item("p-cafe", "Café", 0, 4); // sugerida 8

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function errorResponse(status: number) {
  return jsonResponse({ error: { code: "ERROR", message: "Fallo" } }, status);
}

describe("RestockSelection", () => {
  let requests: string[];
  /** Respuesta de `GET /api/inventory` según `skip`. */
  let inventoryResponse: (skip: number) => Response | Promise<Response>;
  /** Vínculos de proveedor por producto; `"error"` = 500. */
  let supplierLinks: Record<string, RestockSupplierLink[] | "error">;

  beforeEach(() => {
    mockPush.mockReset();
    mockPermission.profile = { storeId: "store-1", user: { id: "user-1" } };
    window.sessionStorage.clear();
    requests = [];
    supplierLinks = {
      "p-aceite": [link("s-beta", "Beta", { lastPurchasedAt: "2026-10-01T10:00:00.000Z" })],
      "p-arroz": [link("s-alfa", "Alfa", { isPreferred: true, lastCostRef: 1.25 })],
      "p-cafe": [link("s-alfa", "Alfa", { isPreferred: true })],
      "p-sal": [],
    };
    inventoryResponse = () =>
      jsonResponse({ data: { items: [ARROZ, ACEITE, SAL, CAFE], limit: 50, skip: 0, total: 4 } });
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");

      requests.push(`${url.pathname}${url.search}`);

      if (url.pathname === "/api/inventory") {
        return inventoryResponse(Number(url.searchParams.get("skip") ?? 0));
      }

      const productId = /^\/api\/products\/([^/]+)\/suppliers$/.exec(url.pathname)?.[1];

      if (productId) {
        const links = supplierLinks[productId] ?? [];

        return links === "error"
          ? errorResponse(500)
          : jsonResponse({ data: { items: links, limit: 100, skip: 0, total: links.length } });
      }

      return errorResponse(404);
    }) as unknown as typeof fetch;
  });

  function renderSelection(onCreated?: () => void) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <RestockSelection onCreated={onCreated} />
      </QueryClientProvider>,
    );
  }

  function row(name: string) {
    return screen.getByRole("checkbox", { name: `Seleccionar ${name}` }).closest("li") as HTMLElement;
  }

  function quantityField(name: string) {
    return screen.getByRole("textbox", { name: `Cantidad a pedir de ${name}` });
  }

  function supplierRequests() {
    return requests.filter((request) => request.includes("/suppliers"));
  }

  /** Lee la precarga a partir del `href` con el que se navegó. */
  function savedDraft() {
    expect(mockPush).toHaveBeenCalledTimes(1);

    const href = String(mockPush.mock.calls[0][0]);
    const id = new URL(href, "http://localhost").searchParams.get(RESTOCK_QUERY_PARAM);

    expect(href).toBe(`/purchases/create?restock=${id}`);

    const result = readRestockDraft(id, SESSION);

    if (result.status !== "ok") {
      throw new Error(`Precarga ${result.status}`);
    }

    return result.draft;
  }

  it("pide los productos por reponer al servidor y sugiere mínimo × 2 − stock", async () => {
    renderSelection();

    expect(await screen.findByRole("list", { name: "Productos por reponer" })).toBeInTheDocument();
    expect(requests).toEqual(["/api/inventory?limit=50&lowStock=true&skip=0"]);
    expect(quantityField("Arroz")).toHaveValue("8");
    expect(quantityField("Aceite")).toHaveValue("13");
    expect(quantityField("Sal")).toHaveValue("1");
    expect(within(row("Aceite")).getByText(/Stock -3 · Mínimo 5 · Stock Bajo/)).toBeInTheDocument();
    expect(within(row("Sal")).getByText(/Stock 0 · Mínimo 0 · Sin Stock/)).toBeInTheDocument();
    expect(screen.getByText("4 productos por reponer.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("no usa campos `type=number` y el proveedor no se consulta hasta seleccionar", async () => {
    const { container } = renderSelection();

    await screen.findByRole("list", { name: "Productos por reponer" });

    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(quantityField("Arroz")).toBeDisabled();
    expect(within(row("Arroz")).getByText("Se consulta al seleccionarlo")).toBeInTheDocument();
    expect(supplierRequests()).toEqual([]);
    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();
    expect(screen.getByText("Selecciona al menos un producto.")).toBeInTheDocument();
  });

  it("muestra el estado de carga", async () => {
    let resolve: (response: Response) => void = () => undefined;

    inventoryResponse = () => new Promise<Response>((done) => (resolve = done));
    renderSelection();

    expect(screen.getByRole("status")).toHaveTextContent("Cargando productos por reponer...");

    await act(async () =>
      resolve(jsonResponse({ data: { items: [ARROZ], limit: 50, skip: 0, total: 1 } })),
    );

    expect(await screen.findByText("1 producto por reponer.")).toBeInTheDocument();
  });

  it("muestra el estado vacío", async () => {
    inventoryResponse = () => jsonResponse({ data: { items: [], limit: 50, skip: 0, total: 0 } });
    renderSelection();

    expect(await screen.findByText("No hay productos por reponer.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CREATE })).not.toBeInTheDocument();
  });

  it("muestra el error y reintenta", async () => {
    const user = userEvent.setup();

    inventoryResponse = () => errorResponse(500);
    renderSelection();

    expect(
      await screen.findByText("No pudimos cargar los productos por reponer"),
    ).toBeInTheDocument();

    inventoryResponse = () =>
      jsonResponse({ data: { items: [ARROZ], limit: 50, skip: 0, total: 1 } });
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("checkbox", { name: "Seleccionar Arroz" })).toBeInTheDocument();
  });

  it("con 403 dice que falta el permiso de inventario, sin botón de reintentar", async () => {
    inventoryResponse = () => errorResponse(403);
    renderSelection();

    expect(await screen.findByText("No tienes permiso para ver el inventario")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("si hay más productos de los que se muestran lo dice y deja cargar más", async () => {
    const user = userEvent.setup();

    inventoryResponse = (skip) =>
      jsonResponse({
        data: {
          items: skip === 0 ? [ARROZ, ACEITE] : skip === 2 ? [SAL] : [CAFE],
          limit: 50,
          skip,
          total: 4,
        },
      });
    renderSelection();

    expect(
      await screen.findByText(/Mostrando 2 de 4 productos por reponer\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Seleccionar Sal" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    expect(await screen.findByRole("checkbox", { name: "Seleccionar Sal" })).toBeInTheDocument();
    expect(screen.getByText(/Mostrando 3 de 4 productos por reponer\./)).toBeInTheDocument();
    expect(requests).toContain("/api/inventory?limit=50&lowStock=true&skip=2");

    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    expect(await screen.findByText("4 productos por reponer.")).toBeInTheDocument();
    expect(requests).toContain("/api/inventory?limit=50&lowStock=true&skip=3");
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("al seleccionar consulta solo ese producto y crea la compra con su proveedor", async () => {
    const user = userEvent.setup();
    const onCreated = jest.fn();

    renderSelection(onCreated);

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar Arroz" }));

    expect(await within(row("Arroz")).findByText("Alfa")).toBeInTheDocument();
    expect(supplierRequests()).toEqual(["/api/products/p-arroz/suppliers?isActive=true&limit=100"]);
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Resumen por proveedor" });

    expect(within(summary).getByText("Alfa")).toBeInTheDocument();
    expect(within(summary).getByText("· 1 producto · 8 unidades")).toBeInTheDocument();
    expect(within(summary).queryByRole("radio")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: CREATE }));

    expect(savedDraft()).toMatchObject({
      lines: [
        {
          currentStock: 2,
          lastCostRef: 1.25,
          minStock: 5,
          name: "Arroz",
          productId: "p-arroz",
          sku: "P-ARROZ",
          suggestedQuantity: 8,
        },
      ],
      supplier: { id: "s-alfa", name: "Alfa" },
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("con varios proveedores obliga a elegir uno y no los mezcla en la precarga", async () => {
    const user = userEvent.setup();

    renderSelection();

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar todos" }));

    expect(screen.getByText("4 seleccionados")).toBeInTheDocument();
    await waitFor(() => expect(supplierRequests()).toHaveLength(4));

    const summary = screen.getByRole("region", { name: "Resumen por proveedor" });
    const radios = await within(summary).findAllByRole("radio");

    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual([
      "Alfa · 2 productos · 16 unidades",
      "Beta · 1 producto · 13 unidades",
      "Sin proveedor · 1 producto · 1 unidad",
    ]);
    expect(within(summary).getByText(/La selección abarca 3 proveedores/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();
    expect(screen.getByText("Elige con qué proveedor crear la compra ahora.")).toBeInTheDocument();

    await user.click(radios[0]);
    await user.click(screen.getByRole("button", { name: CREATE }));

    const draft = savedDraft();

    expect(draft.supplier).toEqual({ id: "s-alfa", name: "Alfa" });
    expect(draft.lines.map((line) => line.productId)).toEqual(["p-arroz", "p-cafe"]);
  });

  it("el grupo 'Sin proveedor' viaja sin proveedor", async () => {
    const user = userEvent.setup();

    renderSelection();

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar Sal" }));

    expect(await within(row("Sal")).findByText("Sin proveedor")).toBeInTheDocument();
    expect(
      screen.getByText(/no tienen proveedor habitual ni compras previas/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: CREATE }));

    const draft = savedDraft();

    expect("supplier" in draft).toBe(false);
    expect(draft.lines).toEqual([
      { currentStock: 0, minStock: 0, name: "Sal", productId: "p-sal", sku: "P-SAL", suggestedQuantity: 1 },
    ]);
  });

  it("la cantidad sugerida se puede cambiar y viaja la tecleada", async () => {
    const user = userEvent.setup();

    renderSelection();

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar Arroz" }));
    await within(row("Arroz")).findByText("Alfa");
    await user.clear(quantityField("Arroz"));

    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();
    expect(within(row("Arroz")).getByText("Entero de 1 en adelante.")).toBeInTheDocument();
    expect(
      screen.getByText("Corrige las cantidades: deben ser enteros de 1 en adelante."),
    ).toBeInTheDocument();

    await user.type(quantityField("Arroz"), "0");
    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();

    await user.clear(quantityField("Arroz"));
    await user.type(quantityField("Arroz"), "24");

    expect(
      within(screen.getByRole("region", { name: "Resumen por proveedor" })).getByText(
        "· 1 producto · 24 unidades",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: CREATE }));

    expect(savedDraft().lines[0].suggestedQuantity).toBe(24);
  });

  it("si falla la consulta del proveedor lo avisa, no lo cuela como 'Sin proveedor' y deja reintentar", async () => {
    const user = userEvent.setup();

    supplierLinks["p-arroz"] = "error";
    renderSelection();

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar Arroz" }));

    expect(
      await within(row("Arroz")).findByText("No se pudo consultar el proveedor."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 producto seleccionado no entra en ninguna compra: no se pudo consultar su proveedor.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();

    supplierLinks["p-arroz"] = [link("s-alfa", "Alfa", { isPreferred: true })];
    await user.click(within(row("Arroz")).getByRole("button", { name: "Reintentar" }));

    expect(await within(row("Arroz")).findByText("Alfa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CREATE })).toBeEnabled();
  });

  it("al quitar la selección el producto sale del resumen", async () => {
    const user = userEvent.setup();

    renderSelection();

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar Arroz" }));
    await within(row("Arroz")).findByText("Alfa");
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Arroz" }));

    expect(screen.getByText("0 seleccionados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("sin sesión cargada no deja crear la compra", async () => {
    const user = userEvent.setup();

    mockPermission.profile = undefined;
    renderSelection();

    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar Arroz" }));
    await within(row("Arroz")).findByText("Alfa");

    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();
    expect(screen.getByText("Cargando tu sesión…")).toBeInTheDocument();
  });
});
