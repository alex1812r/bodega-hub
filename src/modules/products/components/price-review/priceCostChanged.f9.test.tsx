import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import type { ProductPriceReviewItem } from "../../hooks/usePriceReview";
import { productsQueryKeys } from "../../hooks/useProducts";
import { KeepPriceConfirmModal } from "./KeepPriceConfirmModal";
import { PriceReviewRepriceResult } from "./PriceReviewRepriceResult";
import { PurchaseRepriceNotice } from "./PurchaseRepriceNotice";
import { RepriceConfirmModal } from "./RepriceConfirmModal";

/**
 * PRO-F9 · la UI envía el costo que el usuario vio y, si el servidor responde
 * que el costo cambió, lo dice y refresca los datos en vez de mostrar éxito
 * (ALTA-1: "60 precios actualizados" con 56 bajo el costo; M1: "Precio
 * mantenido" con una ganancia que el usuario no había visto).
 */

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));

const COST_CHANGED_MESSAGE = "El costo cambió de 10.00 a 14.00; revisa el precio";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const fetchMock = jest.fn();

function posts() {
  return fetchMock.mock.calls
    .filter(([, init]: [string, RequestInit | undefined]) => init?.method === "POST")
    .map(([url, init]: [string, RequestInit]) => ({ body: JSON.parse(String(init.body)), url }));
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );

  return { invalidate, user: userEvent.setup({ delay: null }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

describe("KeepPriceConfirmModal · costo esperado (M1)", () => {
  const product = { currentCostRef: 10, id: "prod-1", name: "Harina PAN", salePriceRef: 12.5 };

  it("envía el costo con el que mostró la ganancia; ante el 409 muestra el motivo, no cierra ni anuncia éxito, y refresca", async () => {
    // La relectura al abrir (CNF-F10) y la de después del 409: el producto sigue en la cola.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ error: { code: "CONFLICT", message: COST_CHANGED_MESSAGE } }, 409)
        : jsonResponse({ data: { ...product, priceReview: {} } }),
    );
    const onOpenChange = jest.fn();
    const { invalidate, user } = renderWithClient(
      <KeepPriceConfirmModal onOpenChange={onOpenChange} open product={product} />,
    );
    const dialog = within(await screen.findByRole("dialog"));

    expect(await dialog.findByText(/con una ganancia de 25 %/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Mantener precio" }));

    expect(await dialog.findByText(COST_CHANGED_MESSAGE)).toBeVisible();
    expect(posts()).toEqual([{ body: { expectedCostRef: 10 }, url: "/api/products/prod-1/keep-price" }]);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText("Precio mantenido")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productsQueryKeys.all });
  });
});

describe("RepriceConfirmModal · costo de la vista previa (ALTA-1)", () => {
  it("envía cada producto con el costo sobre el que calculó el precio mostrado", async () => {
    const result = { failed: 0, results: [], updated: 2 };
    // La relectura de la cola al abrir (CNF-F10) trae los mismos costos que la lista.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ data: result })
        : jsonResponse({
            data: {
              items: [
                { currentCostRef: 12, productId: "prod-1", salePriceRef: 13 },
                { currentCostRef: 0, productId: "prod-2", salePriceRef: 4 },
              ],
              limit: 100,
              skip: 0,
              total: 2,
            },
          }),
    );
    const onDone = jest.fn();
    const { user } = renderWithClient(
      <RepriceConfirmModal
        markupPct={30}
        onDone={onDone}
        onOpenChange={jest.fn()}
        open
        products={[
          { currentCostRef: 12, id: "prod-1", name: "Harina", salePriceRef: 13 },
          { currentCostRef: 0, id: "prod-2", name: "Sin costo", salePriceRef: 4 },
        ]}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Cambiar 2 precios" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result));
    expect(posts()).toEqual([
      {
        body: {
          // Clave de idempotencia del intento (FIN-03).
          clientRequestId: expect.any(String),
          items: [
            { expectedCostRef: 12, productId: "prod-1" },
            { expectedCostRef: 0, productId: "prod-2" },
          ],
          markupPct: 30,
        },
        url: "/api/products/price-review/reprice",
      },
    ]);
  });
});

describe("PriceReviewRepriceResult · fila COST_CHANGED (ALTA-1)", () => {
  it("dice que el costo cambió y que hay que volver a revisar, junto a los que sí se actualizaron", () => {
    render(
      <PriceReviewRepriceResult
        onDismiss={jest.fn()}
        productNames={{ "prod-1": "Harina PAN", "prod-2": "Arroz" }}
        result={{
          failed: 1,
          results: [
            { code: "COST_CHANGED", message: "El costo cambió de 12.00 a 20.00; revisa el precio", productId: "prod-1", status: "error" },
            { productId: "prod-2", salePriceRef: 11.7, status: "ok" },
          ],
          updated: 1,
        }}
      />,
    );

    const region = within(screen.getByRole("region", { name: "Resultado del reprecio" }));

    expect(region.getByText("1 precio actualizado")).toBeInTheDocument();
    expect(region.getByText("1 no se pudo cambiar:")).toBeInTheDocument();
    expect(region.getByRole("listitem")).toHaveTextContent("Harina PAN · El costo cambió; vuelve a revisar");
  });
});

describe("PurchaseRepriceNotice · costo esperado (ALTA-1, M1)", () => {
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

  function serve() {
    let queueReads = 0;
    let conflicted = false;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        conflicted = true;

        return jsonResponse({ error: { code: "CONFLICT", message: COST_CHANGED_MESSAGE } }, 409);
      }

      if (url.startsWith("/api/settings/pricing")) {
        return jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
      }

      // Tasa vigente de la confirmación (CNF-07): no es una lectura de la cola.
      if (url.startsWith("/api/exchange-rates/current")) {
        return jsonResponse({ data: { rateVes: 40 } });
      }

      // Relectura del producto: al abrir la confirmación (CNF-F10) aún cuesta lo de la
      // cola; tras el 409 sigue en ella, ya con el costo nuevo.
      if (url === "/api/products/prod-1") {
        const currentCostRef = conflicted ? 14 : 10;

        return jsonResponse({
          data: { currentCostRef, id: "prod-1", priceReview: { currentCostRef }, salePriceRef: 10 },
        });
      }

      queueReads += 1;

      return jsonResponse({ data: { items: [item], limit: 100, skip: 0, total: 1 } });
    });

    return () => queueReads;
  }

  it("Aplicar con el costo cambiado: el 409 se ve en el diálogo, no hay toast de éxito y la cola se vuelve a leer", async () => {
    const queueReads = serve();
    const { user } = renderWithClient(<PurchaseRepriceNotice purchaseId="pur-1" />);

    await user.click(await screen.findByRole("button", { name: "Aplicar" }));
    const readsBefore = queueReads();
    await user.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "Aplicar precio" }));

    expect(await within(screen.getByRole("dialog")).findByText(COST_CHANGED_MESSAGE)).toBeVisible();
    expect(posts()).toEqual([
      {
        body: { expectedCostRef: 10, reason: "Reprecio al 25 % por compra C-000123", salePriceRef: 12.5 },
        url: "/api/products/prod-1/price",
      },
    ]);
    expect(screen.queryByText(/Precio actualizado/)).not.toBeInTheDocument();
    await waitFor(() => expect(queueReads()).toBeGreaterThan(readsBefore));
  });

  // CNF-F3: "Mantener precio" confirma con el mismo modal que la lista y el detalle.
  it("Mantener precio con el costo cambiado: el 409 se ve en el diálogo, con la ganancia del costo nuevo, y la fila sigue ahí", async () => {
    serve();
    const { user } = renderWithClient(<PurchaseRepriceNotice purchaseId="pur-1" />);
    const row = within(await screen.findByTestId("purchase-reprice-row-prod-1"));

    await user.click(row.getByRole("button", { name: "Mantener precio" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Mantener precio" }));

    expect(posts()).toEqual([]);
    await user.click(await dialog.findByRole("button", { name: "Mantener precio" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(COST_CHANGED_MESSAGE);
    // 10 sobre un costo de 14: la ganancia que de verdad se aceptaría.
    expect(await dialog.findByText(/con una ganancia de -28,57 %/)).toBeInTheDocument();
    expect(posts()).toEqual([
      {
        body: { expectedCostRef: 10, reason: "Precio mantenido tras compra C-000123" },
        url: "/api/products/prod-1/keep-price",
      },
    ]);
    expect(screen.queryByText("Precio mantenido")).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row.getByRole("button", { name: "Mantener precio" })).toBeEnabled();
  });
});
