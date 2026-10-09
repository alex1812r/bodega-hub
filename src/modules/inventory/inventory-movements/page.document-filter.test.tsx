/**
 * DET-05 · `/inventory/movements?saleId=…` / `?purchaseId=…`: la lista que abre
 * «Ver movimientos de stock» del detalle de una venta o una compra. El filtro
 * llega al servidor y a la exportación, se avisa de que está puesto, se puede
 * quitar y «Volver» regresa al documento de origen.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InventoryMovement } from "../hooks/useInventory";

const mockExportMovementsToExcel = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/inventory/movements",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("./components/InventoryAdjustmentModal", () => ({
  InventoryAdjustmentModal: () => null,
}));
jest.mock("./components/InventoryPackConversionModal", () => ({
  InventoryPackConversionModal: () => null,
}));
jest.mock("./services/exportMovementsExcel", () => ({
  exportMovementsToExcel: (...args: unknown[]) => mockExportMovementsToExcel(...args),
}));

import { InventoryMovementsPage } from "./page";

const SALE_LIST = "/sales?status=pagada&page=2";
const SALE_DETAIL = `/sales/sale-1?returnTo=${encodeURIComponent(SALE_LIST)}`;

const SALE_MOVEMENT: InventoryMovement = {
  createdAt: "2026-10-05T16:00:00.000Z",
  documentKind: "venta",
  documentNumber: "V-0001",
  id: "mov-venta",
  productId: "p-harina",
  quantityDelta: -2,
  saleId: "sale-1",
  stockAfter: 18,
  type: "venta",
};

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

describe("InventoryMovementsPage · filtro por documento (DET-05)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockExportMovementsToExcel.mockReset();
    mockExportMovementsToExcel.mockResolvedValue(undefined);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).split("?")[0] === "/api/inventory/movements"
        ? jsonResponse({ data: { items: [SALE_MOVEMENT], limit: 10, skip: 0, total: 1 } })
        : jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } }),
    );
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage(query: string) {
    window.history.replaceState(null, "", `/inventory/movements?${query}`);

    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InventoryMovementsPage />
      </QueryClientProvider>,
    );
  }

  /** Parámetros de cada `GET /api/inventory/movements`, en orden. */
  function movementRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/inventory/movements")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  it("?saleId= pide al servidor solo los movimientos de esa venta y lo avisa", async () => {
    renderPage("saleId=sale-1");

    await screen.findAllByText("V-0001");

    expect(movementRequests()).toEqual([{ limit: "10", saleId: "sale-1", skip: "0" }]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Solo se muestran los movimientos de una venta.",
    );
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  it("?purchaseId= pide al servidor solo los movimientos de esa compra y lo avisa", async () => {
    renderPage("purchaseId=purchase-7&page=2");

    await screen.findAllByText("V-0001");

    expect(movementRequests()[0]).toEqual({ limit: "10", purchaseId: "purchase-7", skip: "10" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Solo se muestran los movimientos de una compra.",
    );
  });

  it("«Ver todos los documentos» quita el filtro de la URL, conserva returnTo y vuelve a pedir", async () => {
    const user = userEvent.setup();

    renderPage(`saleId=sale-1&type=venta&returnTo=${encodeURIComponent(SALE_DETAIL)}`);
    await screen.findAllByText("V-0001");

    await user.click(screen.getByRole("button", { name: "Ver todos los documentos" }));

    const params = new URLSearchParams(window.location.search);

    expect(params.has("saleId")).toBe(false);
    expect(params.get("type")).toBe("venta");
    expect(params.get("returnTo")).toBe(SALE_DETAIL);
    await waitFor(() =>
      expect(movementRequests().at(-1)).toEqual({ limit: "10", skip: "0", type: "venta" }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("«Limpiar filtros» también lo quita", async () => {
    const user = userEvent.setup();

    renderPage("purchaseId=purchase-7");
    await screen.findAllByText("V-0001");

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    expect(window.location.search).toBe("");
    await waitFor(() => expect(movementRequests().at(-1)).toEqual({ limit: "10", skip: "0" }));
  });

  it("exporta con el mismo filtro de documento que la pantalla", async () => {
    const user = userEvent.setup();

    renderPage("saleId=sale-1");
    await screen.findAllByText("V-0001");

    await user.click(screen.getByRole("button", { name: "Exportar Excel" }));

    expect(mockExportMovementsToExcel).toHaveBeenCalledWith(
      expect.objectContaining({ saleId: "sale-1" }),
    );
  });

  it("«Volver» regresa al detalle de la venta con SU returnTo (lista de origen)", async () => {
    renderPage(`saleId=sale-1&returnTo=${encodeURIComponent(SALE_DETAIL)}`);
    await screen.findAllByText("V-0001");

    const href = screen.getByRole("link", { name: "Volver" }).getAttribute("href");

    expect(href).toBe(SALE_DETAIL);
    expect(new URLSearchParams(href?.split("?")[1]).get("returnTo")).toBe(SALE_LIST);
  });

  it("el documento de cada fila vuelve a esta lista filtrada, que sigue sabiendo volver a la venta", async () => {
    renderPage(`saleId=sale-1&returnTo=${encodeURIComponent(SALE_DETAIL)}`);

    const href = (await screen.findAllByRole("link", { name: "V-0001" }))[0].getAttribute("href");
    const listUrl = new URLSearchParams(href?.split("?")[1]).get("returnTo") as string;
    const listParams = new URLSearchParams(listUrl.split("?")[1]);

    expect(href?.split("?")[0]).toBe("/sales/sale-1");
    expect(listUrl.split("?")[0]).toBe("/inventory/movements");
    expect(listParams.get("saleId")).toBe("sale-1");
    expect(listParams.get("returnTo")).toBe(SALE_DETAIL);
  });
});
