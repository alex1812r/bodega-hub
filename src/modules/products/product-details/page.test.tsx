/**
 * PRO-04 · edición desde el detalle del producto: el error de un guardado
 * fallido no sigue ahí al volver a abrir el modal.
 * PRO-08 · la tarjeta de cambio de precio recibe el costo actual y envía lo de siempre.
 * PRO-F4 · el motivo del cambio de precio viaja y se ve en el historial; el error
 * de una edición fallida solo se pinta dentro del modal.
 * PRO-F13 · la descripción del producto se ve en el detalle.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { getPriceChangeReason } from "@/lib/api/dataSourceUi";

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

/** INV-03 · kardex sin movimientos: la tarjeta de kardex queda en su estado vacío. */
const emptyKardex = {
  entries30d: 0,
  exits30d: 0,
  lastMovements: [],
  openingBalance: 10,
  product: { currentStock: 10, id: "p-1", minStock: 2, name: "Arroz", sku: "arroz" },
  series: [],
  truncated: false,
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
  let postResponses: Response[];
  let posts: Array<{ body: Record<string, unknown>; path: string }>;
  let priceHistory: Array<Record<string, unknown>>;
  let productData: Record<string, unknown>;

  beforeEach(() => {
    productData = product;
    patchResponses = [];
    patches = [];
    postResponses = [];
    posts = [];
    priceHistory = [];
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

        return postResponses.shift() ?? jsonResponse({ data: { history: {}, product } });
      }

      if (path === "/api/products/p-1/price-history") {
        return jsonResponse({
          data: { items: priceHistory, limit: 10, skip: 0, total: priceHistory.length },
        });
      }

      if (path === "/api/inventory/kardex") {
        return jsonResponse({ data: emptyKardex });
      }

      return path === "/api/products/p-1"
        ? jsonResponse({ data: productData })
        : jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    // DET-01: la pestaña activa va en la URL y el kardex recuerda si quedó abierto.
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
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

  function infoCard(heading: HTMLElement) {
    return within(heading.closest("section") as HTMLElement);
  }

  it("muestra la descripción del producto en la información general (PRO-F13)", async () => {
    productData = { ...product, description: "Refresco de cola 355 ml" };
    renderPage();

    const card = infoCard(await screen.findByRole("heading", { name: "Información general" }));

    expect(card.getByText("Refresco de cola 355 ml")).toBeInTheDocument();
    expect(card.queryByText("Sin descripción")).not.toBeInTheDocument();
  });

  it("un producto sin descripción dice «Sin descripción» (PRO-F13)", async () => {
    renderPage();

    const card = infoCard(await screen.findByRole("heading", { name: "Información general" }));

    expect(card.getByText("Sin descripción")).toBeInTheDocument();
  });

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
    // PRO-F4: el motivo se ve una sola vez, dentro del modal; la página no lo repite.
    expect(screen.getAllByText(SKU_TAKEN)).toHaveLength(1);
    expect(screen.queryByText("No pudimos actualizar el producto")).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // PRO-F4: con el modal cerrado tampoco queda el error en la página.
    expect(screen.queryByText(SKU_TAKEN)).not.toBeInTheDocument();
    expect(screen.queryByText("No pudimos actualizar el producto")).not.toBeInTheDocument();

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
    // PRO-F4: el cambio hecho desde la edición lleva su motivo automático.
    expect(posts[0]).toEqual({
      body: { reason: "Edición del producto", salePriceRef: 13 },
      path: "/api/products/p-1/price",
    });
  });

  it("la tarjeta de cambio de precio parte del costo actual y envía el precio nuevo con su motivo (PRO-08, PRO-F4)", async () => {
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
    // CNF-07: el cambio se confirma en el modal.
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar precio" }),
    );

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      // `expectedCostRef`: el costo que mostraba la tarjeta (PRO-F9).
      body: { expectedCostRef: 10, reason: "Ajuste de margen a 30 %", salePriceRef: 13 },
      path: "/api/products/p-1/price",
    });
    expect(patches).toHaveLength(0);
  });

  it("la tarjeta envía el motivo escrito a mano y, si se borra, ninguno (PRO-F4)", async () => {
    const user = renderPage();

    const card = within(
      (await screen.findByRole("heading", { name: "Cambio rápido de precio" })).closest(
        "section",
      ) as HTMLElement,
    );

    await user.click(card.getByRole("button", { name: "30 %" }));
    await user.clear(card.getByLabelText("Motivo"));
    await user.type(card.getByLabelText("Motivo"), "Subió el proveedor");
    await user.click(card.getByRole("button", { name: "Actualizar precio" }));
    // CNF-07: el cambio se confirma en el modal.
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar precio" }),
    );

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({
      expectedCostRef: 10,
      reason: "Subió el proveedor",
      salePriceRef: 13,
    });

    await user.click(card.getByRole("button", { name: "12 %" }));
    await user.clear(card.getByLabelText("Motivo"));
    await user.click(card.getByRole("button", { name: "Actualizar precio" }));
    // CNF-07: el cambio se confirma en el modal.
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar precio" }),
    );

    // En blanco viaja vacío: el servidor lo guarda como "sin motivo".
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toEqual({ expectedCostRef: 10, reason: "", salePriceRef: 11.2 });
  });

  it("el historial muestra el motivo guardado y el texto fijo solo como respaldo (PRO-F4)", async () => {
    priceHistory = [
      {
        createdAt: "2026-05-19T10:00:00.000Z",
        id: "h-3",
        productId: "p-1",
        reason: "Ajuste de margen a 30 %",
        salePriceRef: 13,
        userId: "user-admin",
      },
      {
        createdAt: "2026-05-18T10:00:00.000Z",
        id: "h-2",
        productId: "p-1",
        reason: null,
        salePriceRef: 12,
        userId: "user-admin",
      },
      {
        createdAt: "2026-05-17T10:00:00.000Z",
        id: "h-1",
        productId: "p-1",
        salePriceRef: 11,
        userId: "user-admin",
      },
    ];
    renderPage();

    // DET-01: el historial de precios vive en la pestaña Historial.
    fireEvent.click(await screen.findByRole("tab", { name: "Historial" }));

    const table = within(
      (await screen.findByRole("heading", { name: "Historial de precios" })).closest(
        "section",
      ) as HTMLElement,
    );
    const rows = (await table.findAllByRole("row")).slice(1);

    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Ajuste de margen a 30 %")).toBeInTheDocument();
    expect(within(rows[0]).queryByText(getPriceChangeReason())).not.toBeInTheDocument();
    expect(within(rows[1]).getByText(getPriceChangeReason())).toBeInTheDocument();
    expect(within(rows[2]).getByText(getPriceChangeReason())).toBeInTheDocument();
  });

  // QA PRO-11 (base real): la columna "Usuario" mostraba el UUID de quien cambió el precio.
  it("el historial muestra el nombre del usuario, nunca su id, y «—» si no hay nombre (PRO-F7)", async () => {
    const userId = "ecb7f7ff-98e6-487f-ae53-da7a067e1350";

    priceHistory = [
      {
        createdAt: "2026-05-19T10:00:00.000Z",
        id: "h-2",
        kind: "change",
        previousSalePriceRef: 12,
        productId: "p-1",
        reason: "Ajuste",
        salePriceRef: 13,
        userId,
        userName: "Ana Pérez",
      },
      {
        createdAt: "2026-05-17T10:00:00.000Z",
        id: "h-1",
        kind: "baseline",
        previousSalePriceRef: 12,
        productId: "p-1",
        reason: "Línea base de ganancia",
        salePriceRef: 12,
        userId,
        userName: null,
      },
    ];
    renderPage();

    // DET-01: el historial de precios vive en la pestaña Historial.
    fireEvent.click(await screen.findByRole("tab", { name: "Historial" }));

    const table = within(
      (await screen.findByRole("heading", { name: "Historial de precios" })).closest(
        "section",
      ) as HTMLElement,
    );
    const rows = (await table.findAllByRole("row")).slice(1);
    const userCell = (row: HTMLElement) => within(row).getAllByRole("cell")[3];

    expect(userCell(rows[0])).toHaveTextContent("Ana Pérez");
    expect(userCell(rows[1])).toHaveTextContent("—");
    expect(table.queryByText(userId)).not.toBeInTheDocument();
  });

  it("un cambio rápido de precio fallido se avisa en la confirmación y en la página (PRO-F4, CNF-07)", async () => {
    const unhandled = jest.fn();
    const user = renderPage();

    const card = within(
      (await screen.findByRole("heading", { name: "Cambio rápido de precio" })).closest(
        "section",
      ) as HTMLElement,
    );

    postResponses.push(
      jsonResponse({ error: { code: "FORBIDDEN", message: "No autorizado para cambiar precios" } }, 403),
    );
    process.on("unhandledRejection", unhandled);

    try {
      await user.click(card.getByRole("button", { name: "30 %" }));
      await user.click(card.getByRole("button", { name: "Actualizar precio" }));
      // CNF-07: el cambio se confirma en el modal.
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Cambiar precio" }),
      );

      expect(await screen.findByText("No pudimos actualizar el producto")).toBeInTheDocument();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    // El rechazo lo recoge la tarjeta: no sube como promesa sin manejar.
    expect(unhandled).not.toHaveBeenCalled();

    // CNF-07: el motivo del servidor se ve tal cual en la confirmación, que sigue
    // abierta, y queda en la página para cuando se cierre.
    const dialog = within(screen.getByRole("dialog"));

    expect(dialog.getByRole("alert")).toHaveTextContent("No autorizado para cambiar precios");
    expect(posts).toHaveLength(1);

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(screen.getByText("No autorizado para cambiar precios")).toBeInTheDocument();
    expect(card.getByLabelText("Precio REF")).toHaveValue("13");
  });

  it("monta el kardex del producto y su enlace vuelve al detalle (INV-03)", async () => {
    renderPage();

    // DET-01: en el Resumen el kardex va en una sección plegada por defecto.
    const toggle = await screen.findByRole("button", { name: /Kardex del producto/ });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    const heading = await screen.findByRole("heading", { name: "Kardex" });
    const card = within(heading.closest("section") as HTMLElement);

    expect(await card.findByText("Este producto aún no tiene movimientos.")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Ver kardex completo" })).toHaveAttribute(
      "href",
      "/inventory/movements?productId=p-1&returnTo=%2Fproducts%2Fp-1",
    );
    expect(
      (global.fetch as jest.Mock).mock.calls.map(([input]) => String(input)),
    ).toContain("/api/inventory/kardex?productId=p-1");
  });
});
