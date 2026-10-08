import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import type { ProductPriceReviewItem } from "../../hooks/usePriceReview";
import { getPurchaseRepriceProposal, PurchaseRepriceNotice } from "./PurchaseRepriceNotice";

/** PRO-10 · aviso de reprecio en el detalle de una compra. */

let permissions: string[] = [];

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: (permission: string) => permissions.includes(permission) }),
}));

// Sin configuración de la tienda: cortes del semáforo por defecto.
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));

const PURCHASE = { id: "pur-1", number: "C-000123", receivedAt: "2026-10-07T12:00:00.000Z" };

function reviewItem(overrides: Partial<ProductPriceReviewItem> = {}): ProductPriceReviewItem {
  return {
    currentBand: "low",
    currentCostRef: 9,
    currentMarginPct: 11.111111,
    name: "Harina PAN 1 kg",
    previousBand: "high",
    previousCostRef: 8,
    previousMarginPct: 25,
    productId: "prod-1",
    purchase: PURCHASE,
    salePriceRef: 10,
    sku: "harina-pan",
    snapshotAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function page(items: ProductPriceReviewItem[]) {
  return jsonResponse({ data: { items, limit: 100, skip: 0, total: items.length } });
}

type Call = { body: unknown; method: string; url: string };

const fetchMock = jest.fn();

/** `queues`: lo que devuelve cada lectura sucesiva de la cola (la última se repite). */
function serve(
  queues: ProductPriceReviewItem[][],
  mutation: () => Response | Promise<Response> = () => jsonResponse({ data: {} }),
) {
  let reads = 0;

  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      const items = queues[Math.min(reads, queues.length - 1)];
      reads += 1;

      return page(items);
    }

    return mutation();
  });
}

function calls(): Call[] {
  return fetchMock.mock.calls.map(([url, init]: [string, RequestInit | undefined]) => ({
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    method: init?.method ?? "GET",
    url,
  }));
}

function mutations() {
  return calls().filter((call) => call.method !== "GET");
}

function renderNotice(purchaseId = "pur-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div data-testid="host">
          <PurchaseRepriceNotice purchaseId={purchaseId} />
        </div>
      </ToastProvider>
    </QueryClientProvider>,
  );

  return userEvent.setup({ delay: null });
}

const TITLE = "Productos que bajaron de ganancia con esta compra";

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
  permissions = ["products.view", "products.manage"];
});

describe("PurchaseRepriceNotice", () => {
  it("propone el % anterior sobre el costo actual: 9 al 25 % = 11,25", () => {
    expect(getPurchaseRepriceProposal({ currentCostRef: 9, previousMarginPct: 25 })).toEqual({
      markupPct: 25,
      salePriceRef: 11.25,
    });
  });

  it("sin filas no pinta nada (ni mientras carga ni al terminar)", async () => {
    serve([[]]);
    renderNotice();

    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(calls()[0].url).toBe("/api/products/price-review?limit=100&purchaseId=pur-1");
    await waitFor(() => expect(fetchMock.mock.results[0].value).resolves.toBeDefined());
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("sin permiso para ver productos no consulta ni pinta nada", () => {
    permissions = [];
    serve([[reviewItem()]]);
    renderNotice();

    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si la consulta falla no rompe: aviso discreto con Reintentar", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "X", message: "boom" } }, 500));
    renderNotice();

    expect(await screen.findByText(/No pudimos comprobar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("pinta la fila con las cifras del plan: 8 → 9, PVP 10, 25 % → 11,11 %, reprecio 11,25", async () => {
    serve([[reviewItem({ purchase: { ...PURCHASE, supplierName: "Distribuidora Polar" } })]]);
    renderNotice();

    const row = within(await screen.findByTestId("purchase-reprice-row-prod-1"));

    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByText("1 producto · Proveedor: Distribuidora Polar")).toBeInTheDocument();
    expect(row.getByText("Costo 8,00 → 9,00 REF")).toBeInTheDocument();
    expect(row.getByText("PVP 10,00 REF")).toBeInTheDocument();
    expect(row.getByText("25 %").closest("[data-band]")).toHaveAttribute("data-band", "high");
    expect(row.getByText("11,11 %").closest("[data-band]")).toHaveAttribute("data-band", "low");
    expect(row.getByText("Reprecio al 25 % → 11,25 REF")).toBeInTheDocument();
    expect(row.getByRole("link", { name: "Harina PAN 1 kg" })).toHaveAttribute("href", "/products/prod-1");
    expect(screen.queryByRole("link", { name: "Ver todos en Productos" })).not.toBeInTheDocument();
  });

  it("Aplicar no cambia nada hasta confirmar; al confirmar envía el precio propuesto y el motivo", async () => {
    serve([[reviewItem()], []]);
    const user = renderNotice();

    await user.click(await screen.findByRole("button", { name: "Aplicar" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.getByText("El precio de Harina PAN 1 kg pasa de 10,00 a 11,25 REF.")).toBeInTheDocument();
    expect(mutations()).toEqual([]);

    await user.click(dialog.getByRole("button", { name: "Aplicar precio" }));

    await waitFor(() =>
      expect(mutations()).toEqual([
        {
          body: { reason: "Reprecio al 25 % por compra C-000123", salePriceRef: 11.25 },
          method: "POST",
          url: "/api/products/prod-1/price",
        },
      ]),
    );
    expect(await screen.findByText("Precio actualizado: Harina PAN 1 kg")).toBeInTheDocument();
    // Era la última fila: el bloque entero desaparece con el refresco de la cola.
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
  });

  it("Mantener precio envía keep-price con su motivo y retira solo esa fila", async () => {
    const other = reviewItem({ name: "Arroz 1 kg", productId: "prod-2", sku: "arroz" });

    serve([[reviewItem(), other], [other]]);
    const user = renderNotice();

    const row = within(await screen.findByTestId("purchase-reprice-row-prod-1"));

    await user.click(row.getByRole("button", { name: "Mantener precio" }));

    await waitFor(() =>
      expect(mutations()).toEqual([
        {
          body: { reason: "Precio mantenido tras compra C-000123" },
          method: "POST",
          url: "/api/products/prod-1/keep-price",
        },
      ]),
    );
    expect(await screen.findByText("Precio mantenido: Harina PAN 1 kg")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("purchase-reprice-row-prod-1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("purchase-reprice-row-prod-2")).toBeInTheDocument();
  });

  it("doble clic en Mantener precio envía una sola vez", async () => {
    let release: (response: Response) => void = () => undefined;

    serve([[reviewItem()]], () => new Promise<Response>((resolve) => (release = resolve)));
    renderNotice();

    const keep = await screen.findByRole("button", { name: "Mantener precio" });

    fireEvent.click(keep);
    fireEvent.click(keep);

    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(keep).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();

    release(jsonResponse({ data: {} }));
    await screen.findByText("Precio mantenido: Harina PAN 1 kg");
    expect(mutations()).toHaveLength(1);
  });

  it("doble clic al confirmar Aplicar envía una sola vez", async () => {
    let release: (response: Response) => void = () => undefined;

    serve([[reviewItem()]], () => new Promise<Response>((resolve) => (release = resolve)));
    const user = renderNotice();

    await user.click(await screen.findByRole("button", { name: "Aplicar" }));

    const confirm = within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Aplicar precio",
    });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(mutations()).toHaveLength(1));
    release(jsonResponse({ data: {} }));
    await screen.findByText("Precio actualizado: Harina PAN 1 kg");
    expect(mutations()).toHaveLength(1);
  });

  it("un error del servidor se ve en su fila, sin perder las demás, y deja reintentar", async () => {
    const other = reviewItem({ name: "Arroz 1 kg", productId: "prod-2", sku: "arroz" });

    serve([[reviewItem(), other]], () =>
      jsonResponse({ error: { code: "CONFLICT", message: "El producto está inactivo." } }, 409),
    );
    const user = renderNotice();

    const row = within(await screen.findByTestId("purchase-reprice-row-prod-1"));

    await user.click(row.getByRole("button", { name: "Mantener precio" }));

    expect(await row.findByRole("alert")).toHaveTextContent("El producto está inactivo.");
    expect(row.getByRole("button", { name: "Mantener precio" })).toBeEnabled();

    const otherRow = within(screen.getByTestId("purchase-reprice-row-prod-2"));

    expect(otherRow.queryByRole("alert")).not.toBeInTheDocument();
    expect(otherRow.getByRole("button", { name: "Aplicar" })).toBeEnabled();
  });

  it("si Aplicar falla, el error se ve en el modal y, al cerrarlo, en la fila", async () => {
    serve([[reviewItem()]], () =>
      jsonResponse({ error: { code: "BAD_REQUEST", message: "Precio no válido." } }, 400),
    );
    const user = renderNotice();

    await user.click(await screen.findByRole("button", { name: "Aplicar" }));

    const dialog = within(await screen.findByRole("dialog"));

    await user.click(dialog.getByRole("button", { name: "Aplicar precio" }));
    expect(await dialog.findByText("Precio no válido.")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const row = within(screen.getByTestId("purchase-reprice-row-prod-1"));

    expect(row.getByRole("alert")).toHaveTextContent("Precio no válido.");
    expect(row.getByRole("button", { name: "Aplicar" })).toBeEnabled();
  });

  it("con más de 10 muestra 10, «Mostrar N más» y el enlace a Productos; sin acción masiva", async () => {
    const items = Array.from({ length: 40 }, (_, index) =>
      reviewItem({ name: `Producto ${index + 1}`, productId: `prod-${index + 1}`, sku: `sku-${index + 1}` }),
    );

    serve([items]);
    const user = renderNotice();

    await screen.findByRole("heading", { name: TITLE });
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("40 productos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todos en Productos" })).toHaveAttribute(
      "href",
      "/products?review=1",
    );

    await user.click(screen.getByRole("button", { name: "Mostrar 30 más" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(40);
    expect(screen.queryByRole("button", { name: /Mostrar \d+ más/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("sin products.manage ve las filas pero no las acciones", async () => {
    permissions = ["products.view"];
    serve([[reviewItem()]]);
    renderNotice();

    expect(await screen.findByText("Reprecio al 25 % → 11,25 REF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mantener precio" })).not.toBeInTheDocument();
  });
});
