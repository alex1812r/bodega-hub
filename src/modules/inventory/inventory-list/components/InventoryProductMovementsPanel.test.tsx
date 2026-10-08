/**
 * INV-02 · panel de kardex en línea de `/inventory`: carga al montarse, saldo
 * tras cada movimiento, documento, enlaces con `returnTo`, descuadre y estados.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InventoryMovement } from "../../hooks/useInventory";
import { InventoryProductMovementsPanel } from "./InventoryProductMovementsPanel";

const RETURN_TO = "/inventory?status=low&product=p-arroz";
const ENCODED_RETURN_TO = encodeURIComponent(RETURN_TO);

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function movement(overrides: Partial<InventoryMovement>): InventoryMovement {
  return {
    createdAt: "2026-10-08T14:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-1",
    productId: "p-arroz",
    quantityDelta: 1,
    stockAfter: 1,
    type: "ajuste_entrada",
    ...overrides,
  };
}

const MOVEMENTS: InventoryMovement[] = [
  movement({
    documentKind: "venta",
    documentNumber: "V-000123",
    id: "mov-venta",
    quantityDelta: -2,
    saleId: "sale-1",
    stockAfter: 4,
    type: "venta",
  }),
  movement({
    documentKind: "compra",
    documentNumber: "C-000045",
    id: "mov-compra",
    purchaseId: "purchase-1",
    quantityDelta: 10,
    stockAfter: 6,
    type: "compra",
  }),
  movement({
    id: "mov-ajuste",
    quantityDelta: -3,
    reason: "Conteo físico",
    stockAfter: -4,
    type: "ajuste_salida",
  }),
  movement({
    conversionId: "conv-1",
    documentKind: "conversion",
    id: "mov-conversion",
    quantityDelta: -1,
    stockAfter: -1,
    type: "conversion_salida",
  }),
  // La base no devolvió el documento: se nombra el tipo, no es un ajuste manual.
  movement({ documentKind: "venta", id: "mov-sin-numero", quantityDelta: -1, stockAfter: 0, type: "venta" }),
];

function movementsPage(items: InventoryMovement[]) {
  return jsonResponse({ data: { items, limit: 10, skip: 0, total: items.length } });
}

describe("InventoryProductMovementsPanel", () => {
  let requests: string[];
  let responses: Array<Response | Promise<Response>>;

  beforeEach(() => {
    requests = [];
    responses = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));

      return responses.shift() ?? movementsPage(MOVEMENTS);
    }) as unknown as typeof fetch;
  });

  function renderPanel(
    product: { currentStock: number; reconciliationDiff?: number | null } = { currentStock: 4 },
  ) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <InventoryProductMovementsPanel
          id="panel-p-arroz"
          product={{ id: "p-arroz", name: "Arroz", ...product }}
          returnTo={RETURN_TO}
        />
      </QueryClientProvider>,
    );
  }

  async function findMovement(text: string) {
    const item = (await screen.findByText(text)).closest("li");

    if (!item) {
      throw new Error(`Sin movimiento para ${text}`);
    }

    return item;
  }

  it("asks once for the last 10 movements of the product when it mounts", async () => {
    renderPanel();

    await findMovement("Venta V-000123");

    expect(requests).toHaveLength(1);

    const [path, query] = requests[0].split("?");

    expect(path).toBe("/api/inventory/movements");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      limit: "10",
      productId: "p-arroz",
    });
  });

  it("is a labelled region with the id the expand button points to", async () => {
    renderPanel();

    const region = screen.getByRole("region", { name: "Últimos movimientos de Arroz" });

    expect(region).toHaveAttribute("id", "panel-p-arroz");
    await findMovement("Venta V-000123");
  });

  it("shows the current stock next to the balance after each movement, newest first", async () => {
    renderPanel();

    const sale = await findMovement("Venta V-000123");

    expect(screen.getByText("Stock actual:")).toHaveTextContent("Stock actual: 4");
    expect(sale).toHaveTextContent("08/10/2026");
    expect(within(sale).getByText("Venta")).toBeInTheDocument();
    expect(within(sale).getByText("-2")).toBeInTheDocument();
    expect(sale).toHaveTextContent("Saldo: 4");

    const purchase = await findMovement("Compra C-000045");

    expect(within(purchase).getByText("+10")).toBeInTheDocument();
    expect(purchase).toHaveTextContent("Saldo: 6");

    expect(
      screen.getAllByRole("listitem").map((item) => /Saldo: (-?\d+)/.exec(item.textContent ?? "")?.[1]),
    ).toEqual(["4", "6", "-4", "-1", "0"]);
  });

  it("links a sale and a purchase to their detail with the list as returnTo", async () => {
    renderPanel();

    await findMovement("Venta V-000123");

    expect(screen.getByRole("link", { name: "Venta V-000123" })).toHaveAttribute(
      "href",
      `/sales/sale-1?returnTo=${ENCODED_RETURN_TO}`,
    );
    expect(screen.getByRole("link", { name: "Compra C-000045" })).toHaveAttribute(
      "href",
      `/purchases/purchase-1?returnTo=${ENCODED_RETURN_TO}`,
    );
  });

  it("says 'Ajuste manual' with its reason when the movement has no document", async () => {
    renderPanel();

    const adjustment = await findMovement("Ajuste manual");

    expect(adjustment).toHaveTextContent("Conteo físico");
    expect(adjustment).toHaveTextContent("Saldo: -4");
    expect(within(adjustment).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ajuste manual")).toHaveLength(1);
  });

  it("names a conversion and a document without number without linking them", async () => {
    renderPanel();

    const conversion = await findMovement("Conversión de empaque");
    const numberless = screen.getAllByRole("listitem")[4];

    expect(within(conversion).queryByRole("link")).not.toBeInTheDocument();
    expect(within(numberless).getAllByText("Venta")).toHaveLength(2);
    expect(within(numberless).queryByRole("link")).not.toBeInTheDocument();
    expect(numberless).not.toHaveTextContent("Ajuste manual");
  });

  it("links to the full kardex of the product with the list, product included, as returnTo", async () => {
    renderPanel();

    expect(screen.getByRole("link", { name: "Ver kardex completo" })).toHaveAttribute(
      "href",
      `/inventory/movements?productId=p-arroz&returnTo=${ENCODED_RETURN_TO}`,
    );
    expect(decodeURIComponent(ENCODED_RETURN_TO)).toContain("product=p-arroz");
    await findMovement("Venta V-000123");
  });

  it("explains the mismatch in one line when the admin's diff is not zero", async () => {
    renderPanel({ currentStock: 4, reconciliationDiff: 3 });

    expect(screen.getByRole("note")).toHaveTextContent(
      "El stock (4) no coincide con la suma de movimientos (1).",
    );
    await findMovement("Venta V-000123");
  });

  it("explains a negative mismatch with the sum of movements above the stock", async () => {
    renderPanel({ currentStock: -4, reconciliationDiff: -2 });

    expect(screen.getByRole("note")).toHaveTextContent(
      "El stock (-4) no coincide con la suma de movimientos (-2).",
    );
    await findMovement("Venta V-000123");
  });

  it.each([
    ["the diff is null", { currentStock: 4, reconciliationDiff: null }],
    ["the diff is zero", { currentStock: 4, reconciliationDiff: 0 }],
    ["the field does not arrive (other roles)", { currentStock: 4 }],
  ])("says nothing about a mismatch when %s", async (_case, product) => {
    renderPanel(product);

    await findMovement("Venta V-000123");

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/no coincide/)).not.toBeInTheDocument();
  });

  it("announces the load and shows no empty message meanwhile", async () => {
    let release: (response: Response) => void = () => undefined;

    responses.push(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent("Cargando movimientos...");
    expect(screen.queryByText("Este producto aún no tiene movimientos.")).not.toBeInTheDocument();
    expect(screen.getByText("Stock actual:")).toHaveTextContent("Stock actual: 4");

    release(movementsPage(MOVEMENTS));

    await findMovement("Venta V-000123");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says the product has no movements yet", async () => {
    responses.push(movementsPage([]));
    renderPanel({ currentStock: 0 });

    expect(await screen.findByText("Este producto aún no tiene movimientos.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver kardex completo" })).toBeInTheDocument();
  });

  it("shows the server error with a retry that repeats the request", async () => {
    const user = userEvent.setup();

    responses.push(
      jsonResponse({ error: { code: "INTERNAL", message: "No se pudieron leer los movimientos." } }, 500),
    );
    renderPanel();

    expect(await screen.findByText("No se pudieron leer los movimientos.")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar los movimientos")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    await findMovement("Venta V-000123");
    expect(requests).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("says the user has no permission on a 403, without retry or kardex link", async () => {
    responses.push(jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403));
    renderPanel();

    expect(
      await screen.findByText("No tienes permiso para ver los movimientos de inventario."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ver kardex completo" })).not.toBeInTheDocument();
  });
});
