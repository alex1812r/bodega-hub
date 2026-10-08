import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import type { ProductPriceReviewItem } from "../../hooks/usePriceReview";
import { KeepPriceConfirmModal } from "./KeepPriceConfirmModal";
import { PurchaseRepriceNotice } from "./PurchaseRepriceNotice";

/**
 * PRO-F11 · tras el 409 por costo cambiado, el diálogo se queda con las cifras
 * viejas y el reintento reenvía el costo viejo (409 otra vez). Ahora relee el
 * producto: muestra el costo y el % actuales y reintenta con el costo nuevo, o
 * se cierra con un aviso si el producto ya no está en "Por revisar".
 */

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));

const COST_CHANGED_MESSAGE = "El costo cambió de 10.50 a 14.00; revisa el precio";
const LEFT_QUEUE_TITLE = "El costo cambió; revisa el producto";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const conflict = () =>
  jsonResponse({ error: { code: "CONFLICT", message: COST_CHANGED_MESSAGE } }, 409);

const fetchMock = jest.fn();

function posts() {
  return fetchMock.mock.calls
    .filter(([, init]: [string, RequestInit | undefined]) => init?.method === "POST")
    .map(([url, init]: [string, RequestInit]) => ({ body: JSON.parse(String(init.body)), url }));
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );

  return userEvent.setup({ delay: null });
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

describe("KeepPriceConfirmModal · reintento tras el costo cambiado (PRO-F11)", () => {
  // Instantánea de la fila de la lista: no cambia aunque la lista se refresque.
  const product = { currentCostRef: 10.5, id: "prod-1", name: "Harina PAN", salePriceRef: 12.5 };
  const review = {
    currentBand: "low",
    currentCostRef: 14,
    currentMarginPct: -10.71,
    previousBand: "mid",
    previousCostRef: 10.5,
    previousMarginPct: 19.05,
    snapshotAt: "2026-10-01T10:00:00.000Z",
  };

  function serve(freshProduct: Record<string, unknown>) {
    let keepCalls = 0;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        keepCalls += 1;

        return keepCalls === 1
          ? conflict()
          : jsonResponse({ data: { history: { kind: "keep" }, product: freshProduct } });
      }

      return jsonResponse({ data: freshProduct });
    });
  }

  it("muestra el costo y el % actuales y reintenta con el costo nuevo", async () => {
    serve({ ...product, currentCostRef: 14, priceReview: review });
    const onOpenChange = jest.fn();
    const user = renderWithClient(
      <KeepPriceConfirmModal onOpenChange={onOpenChange} open product={product} />,
    );
    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.getByText(/con una ganancia de 19,05 %/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Mantener precio" }));

    expect(await dialog.findByText(/con una ganancia de -10,71 %/)).toBeInTheDocument();
    expect(dialog.getByText(COST_CHANGED_MESSAGE)).toBeVisible();
    expect(dialog.queryByText(/19,05 %/)).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(dialog.getByRole("button", { name: "Mantener precio" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts()).toEqual([
      { body: { expectedCostRef: 10.5 }, url: "/api/products/prod-1/keep-price" },
      { body: { expectedCostRef: 14 }, url: "/api/products/prod-1/keep-price" },
    ]);
    expect(screen.getByText("Precio mantenido")).toBeInTheDocument();
  });

  it("si el producto ya no está en la cola, se cierra con un aviso y no reintenta", async () => {
    serve({ ...product, currentCostRef: 9 });
    const onOpenChange = jest.fn();
    const user = renderWithClient(
      <KeepPriceConfirmModal onOpenChange={onOpenChange} open product={product} />,
    );

    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Mantener precio" }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByText(LEFT_QUEUE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText("Precio mantenido")).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });
});

describe("PurchaseRepriceNotice · reintento tras el costo cambiado (PRO-F11)", () => {
  const item: ProductPriceReviewItem = {
    currentBand: "low",
    currentCostRef: 10,
    currentMarginPct: 0,
    name: "Harina PAN 1 kg",
    previousBand: "high",
    previousCostRef: 8,
    previousMarginPct: 25,
    productId: "prod-1",
    purchase: { id: "pur-1", number: "C-000123", receivedAt: "2026-10-07T12:00:00.000Z" },
    salePriceRef: 10,
    sku: "harina-pan",
    snapshotAt: "2026-10-01T12:00:00.000Z",
  };

  /** La cola antes del 409 y la que el servidor entrega al releerla. */
  function serve(queueAfterConflict: ProductPriceReviewItem[]) {
    let conflicted = false;
    let priceCalls = 0;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        priceCalls += 1;

        if (priceCalls === 1) {
          conflicted = true;

          return conflict();
        }

        return jsonResponse({ data: { history: {}, product: {} } });
      }

      if (url.startsWith("/api/settings/pricing")) {
        return jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
      }

      const items = conflicted ? queueAfterConflict : [item];

      return jsonResponse({ data: { items, limit: 100, skip: 0, total: items.length } });
    });
  }

  it("Aplicar: el diálogo pasa a las cifras del costo nuevo y reintenta con él", async () => {
    serve([{ ...item, currentCostRef: 14, currentMarginPct: -28.57 }]);
    const user = renderWithClient(<PurchaseRepriceNotice purchaseId="pur-1" />);

    await user.click(await screen.findByRole("button", { name: "Aplicar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Aplicar precio" }),
    );

    const dialog = within(screen.getByRole("dialog"));

    expect(
      await dialog.findByText("El precio de Harina PAN 1 kg pasa de ref 10.00 a ref 17.50."),
    ).toBeInTheDocument();
    expect(dialog.getByText(COST_CHANGED_MESSAGE)).toBeVisible();

    await user.click(dialog.getByRole("button", { name: "Aplicar precio" }));

    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]).toEqual({
      body: { expectedCostRef: 14, reason: "Reprecio al 25 % por compra C-000123", salePriceRef: 17.5 },
      url: "/api/products/prod-1/price",
    });
  });

  it("Aplicar: si el producto sale de la cola al releerla, avisa en vez de desaparecer en silencio", async () => {
    serve([]);
    const user = renderWithClient(<PurchaseRepriceNotice purchaseId="pur-1" />);

    await user.click(await screen.findByRole("button", { name: "Aplicar" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Aplicar precio" }),
    );

    expect(await screen.findByText(LEFT_QUEUE_TITLE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/Precio actualizado/)).not.toBeInTheDocument();
  });

  it("Mantener precio: si el producto sale de la cola al releerla, avisa", async () => {
    serve([]);
    const user = renderWithClient(<PurchaseRepriceNotice purchaseId="pur-1" />);
    const row = within(await screen.findByTestId("purchase-reprice-row-prod-1"));

    await user.click(row.getByRole("button", { name: "Mantener precio" }));

    expect(await screen.findByText(LEFT_QUEUE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/Precio mantenido:/)).not.toBeInTheDocument();
  });
});
