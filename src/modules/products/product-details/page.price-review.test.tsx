/**
 * PRO-11 · detalle del producto: aviso "Por revisar" con la compra que lo causó,
 * "Reprecio" / "Mantener precio" y el historial de precios con su `kind`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockPermissions: string[] = [];

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/p-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.includes(permission),
    isLoading: false,
    role: "admin",
  }),
}));
jest.mock("../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

import { ProductDetailsPage } from "./page";

const baseProduct = {
  categoryId: "cat-1",
  currentCostRef: 9,
  currentStock: 10,
  id: "p-1",
  isActive: true,
  minStock: 2,
  name: "Arroz",
  salePriceRef: 10,
  sku: "arroz",
};

const priceReview = {
  currentBand: "low",
  currentCostRef: 9,
  currentMarginPct: 11.11,
  previousBand: "high",
  previousCostRef: 8,
  previousMarginPct: 25,
  purchase: {
    id: "pur-7",
    number: "C-20261001-000007",
    receivedAt: "2026-10-01T15:00:00.000Z",
    supplierName: "Distribuidora Ñandú",
  },
  snapshotAt: "2026-09-20T10:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("ProductDetailsPage · Por revisar (PRO-11)", () => {
  const originalMatchMedia = window.matchMedia;
  let product: Record<string, unknown>;
  let posts: Array<{ body: Record<string, unknown>; path: string }>;
  let priceHistory: Array<Record<string, unknown>>;
  let detailRequests: number;

  beforeEach(() => {
    mockPermissions = ["products.view", "products.manage"];
    product = { ...baseProduct, priceReview };
    posts = [];
    priceHistory = [];
    detailRequests = 0;
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

      if (init?.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, path });
        // Como el servidor: tras "Mantener precio" el producto sale de la cola.
        product = { ...baseProduct };

        return jsonResponse({ data: { history: { kind: "keep" }, product } });
      }

      if (path === "/api/products/p-1/price-history") {
        return jsonResponse({
          data: { items: priceHistory, limit: 10, skip: 0, total: priceHistory.length },
        });
      }

      if (path === "/api/settings/pricing") {
        return jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
      }

      if (path === "/api/products/p-1") {
        detailRequests += 1;

        return jsonResponse({ data: product });
      }

      return jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
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

  const findNotice = async () =>
    within(await screen.findByRole("region", { name: "Precio por revisar" }));

  async function historyRows() {
    const table = within(
      (await screen.findByRole("heading", { name: "Historial de precios" })).closest(
        "section",
      ) as HTMLElement,
    );

    return (await table.findAllByRole("row")).slice(1);
  }

  it("shows the notice above the summary with both bands, both costs and the purchase that caused it", async () => {
    renderPage();

    const notice = await findNotice();
    const bands = notice.getAllByTitle("Ganancia sobre el costo (ya con IVA)");

    expect(bands.map((badge) => badge.getAttribute("data-band"))).toEqual(["high", "low"]);
    expect(bands[0]).toHaveTextContent("25 %");
    expect(bands[1]).toHaveTextContent("11,11 %");
    expect(
      notice.getByText("La ganancia bajó de 25 % a 11,11 % al subir el costo de ref 8.00 a ref 9.00"),
    ).toBeInTheDocument();

    const purchase = notice.getByRole("link", { name: "C-20261001-000007" });

    expect(purchase).toHaveAttribute("href", "/purchases/pur-7");
    expect(purchase.closest("p")).toHaveTextContent("de Distribuidora Ñandú");

    const region = screen.getByRole("region", { name: "Precio por revisar" });
    const summary = screen.getByRole("heading", { name: "Información general" });

    expect(region.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Aviso también junto al nombre.
    expect(
      within(screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement).getByText(
        "Por revisar",
      ),
    ).toBeInTheDocument();
  });

  it("omits the purchase line when the cost changed some other way", async () => {
    product = { ...baseProduct, priceReview: { ...priceReview, purchase: undefined } };
    renderPage();

    const notice = await findNotice();

    expect(notice.queryByRole("link")).not.toBeInTheDocument();
    expect(notice.getByRole("button", { name: "Mantener precio" })).toBeInTheDocument();
  });

  it("has no notice for a product that is not under review", async () => {
    product = { ...baseProduct };
    renderPage();

    await screen.findByRole("heading", { name: "Información general" });

    expect(screen.queryByRole("region", { name: "Precio por revisar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Por revisar")).not.toBeInTheDocument();
  });

  it("'Reprecio' takes the focus to the price card, which suggests the % that restores the previous band", async () => {
    const user = renderPage();
    const notice = await findNotice();

    await user.click(notice.getByRole("button", { name: "Reprecio" }));

    const card = screen.getByRole("heading", { name: "Cambio rápido de precio" })
      .parentElement as HTMLElement;
    const suggested = within(card).getByRole("button", { name: "Sugerido 25 %" });

    expect(suggested).toHaveFocus();
    // Nada cambia hasta que el usuario lo confirma (regla 10b).
    expect(posts).toHaveLength(0);
  });

  it("keeps the price from the notice after confirming, and the product leaves the queue", async () => {
    const user = renderPage();
    const notice = await findNotice();

    await user.click(notice.getByRole("button", { name: "Mantener precio" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(
      dialog.getByText(
        "El precio se queda en ref 10.00 con una ganancia de 11,11 %. Saldrá de la lista hasta que el costo vuelva a subir.",
      ),
    ).toBeInTheDocument();
    expect(posts).toHaveLength(0);

    const requestsBefore = detailRequests;

    await user.click(dialog.getByRole("button", { name: "Mantener precio" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Precio por revisar" })).not.toBeInTheDocument(),
    );
    expect(posts).toEqual([{ body: {}, path: "/api/products/p-1/keep-price" }]);
    expect(detailRequests).toBeGreaterThan(requestsBefore);
  });

  it("shows the notice without actions to someone who cannot manage products", async () => {
    mockPermissions = ["products.view"];
    renderPage();

    const notice = await findNotice();

    expect(notice.getByRole("link", { name: "C-20261001-000007" })).toBeInTheDocument();
    expect(notice.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mantener precio" })).not.toBeInTheDocument();
  });

  it("labels each history row by its kind and takes the previous price from the row itself", async () => {
    priceHistory = [
      {
        createdAt: "2026-05-20T10:00:00.000Z",
        id: "h-4",
        kind: "keep",
        previousSalePriceRef: 16,
        productId: "p-1",
        reason: "Precio mantenido",
        salePriceRef: 16,
        userId: "user-admin",
        userName: "Admin Demo",
      },
      {
        createdAt: "2026-05-19T10:00:00.000Z",
        id: "h-3",
        kind: "change",
        previousSalePriceRef: 14,
        productId: "p-1",
        reason: "Ajuste de margen a 30 %",
        salePriceRef: 16,
        userId: "user-admin",
        userName: "Admin Demo",
      },
      {
        createdAt: "2026-05-18T10:00:00.000Z",
        id: "h-2",
        kind: "keep",
        previousSalePriceRef: 14,
        productId: "p-1",
        reason: "Precio de la competencia",
        salePriceRef: 14,
        userId: "user-admin",
      },
      {
        createdAt: "2026-05-17T10:00:00.000Z",
        id: "h-1",
        kind: "baseline",
        previousSalePriceRef: 14,
        productId: "p-1",
        reason: "Línea base de ganancia",
        salePriceRef: 14,
        userId: "user-admin",
        userName: null,
      },
    ];
    renderPage();

    const rows = await historyRows();
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);

    expect(rows).toHaveLength(4);
    // keep: sin precio tachado ni flecha de cambio, y la etiqueta una sola vez.
    // La columna "Usuario" lleva el nombre, nunca el id (PRO-F7).
    expect(cells(rows[0])).toEqual([expect.any(String), "—", "ref 16.00", "Admin Demo", "Precio mantenido"]);
    expect(rows[0].querySelector(".line-through")).toBeNull();
    // change: como hoy, anterior tachado → nuevo.
    expect(cells(rows[1])).toEqual([
      expect.any(String),
      "ref 14.00",
      "ref 16.00",
      "Admin Demo",
      "Ajuste de margen a 30 %",
    ]);
    expect(within(rows[1]).getByText("ref 14.00")).toHaveClass("line-through");
    // keep con motivo propio: etiqueta + motivo.
    expect(cells(rows[2])[4]).toBe("Precio mantenidoPrecio de la competencia");
    // baseline, la fila más antigua: nunca "14.00 → 14.00".
    expect(cells(rows[3])).toEqual([expect.any(String), "—", "ref 14.00", "—", "Línea base"]);
    expect(rows[3].querySelector(".line-through")).toBeNull();
  });

  it("does not invent a previous price for the oldest change when the row has none", async () => {
    priceHistory = [
      {
        createdAt: "2026-05-19T10:00:00.000Z",
        id: "h-2",
        kind: "change",
        previousSalePriceRef: 12,
        productId: "p-1",
        reason: "Sube el costo",
        salePriceRef: 14,
        userId: "user-admin",
      },
      {
        createdAt: "2026-05-17T10:00:00.000Z",
        id: "h-1",
        kind: "change",
        previousSalePriceRef: null,
        productId: "p-1",
        reason: "Alta",
        salePriceRef: 14,
        userId: "user-admin",
      },
    ];
    renderPage();

    const rows = await historyRows();

    expect(within(rows[0]).getByText("ref 12.00")).toHaveClass("line-through");
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("—");
    expect(within(rows[1]).getAllByText("ref 14.00")).toHaveLength(1);
  });

  it("falls back to the neighbouring row only for entries that carry no previous price field", async () => {
    priceHistory = [
      { createdAt: "2026-05-19T10:00:00.000Z", id: "h-2", productId: "p-1", salePriceRef: 13, userId: "u" },
      { createdAt: "2026-05-17T10:00:00.000Z", id: "h-1", productId: "p-1", salePriceRef: 11, userId: "u" },
    ];
    renderPage();

    const rows = await historyRows();

    expect(within(rows[0]).getByText("ref 11.00")).toHaveClass("line-through");
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("—");
  });
});
