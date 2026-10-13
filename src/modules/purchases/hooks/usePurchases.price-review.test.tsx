/**
 * PRO-F6 · recibir una compra cambia el costo de sus productos: la cola "Por
 * revisar" y las vistas de productos ya montadas tienen que volver a pedirse en
 * la misma recepción, sin recargar ni esperar a que caduque la caché.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PurchaseRepriceNotice } from "@/modules/products/components/price-review/PurchaseRepriceNotice";
import { usePriceReviewSummary } from "@/modules/products/hooks/usePriceReview";
import { useProduct, useProducts } from "@/modules/products/hooks/useProducts";
import { ToastProvider } from "@/shared/components/Toast";

import { useReceivePurchase } from "./usePurchases";

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));

const REVIEW_ITEM = {
  currentBand: "low",
  currentCostRef: 9,
  currentMarginPct: 11.111111,
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

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

const fetchMock = jest.fn();
let isReceived = false;

function gets(prefix: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]: [string, RequestInit | undefined]) =>
      (init?.method ?? "GET") === "GET" && url.split("?")[0] === prefix,
  ).length;
}

/** Lo que hay montado en una sesión real: detalle de compra + vistas de productos ya visitadas. */
function PurchaseDetailHarness() {
  const receive = useReceivePurchase("pur-1");
  const summary = usePriceReviewSummary();

  useProducts({ review: "1" });
  useProduct("prod-1");

  return (
    <>
      <button onClick={() => receive.mutate(undefined)} type="button">
        Recibir pedido
      </button>
      <output data-testid="summary">{summary.data?.total ?? ""}</output>
      <PurchaseRepriceNotice purchaseId="pur-1" />
    </>
  );
}

beforeEach(() => {
  isReceived = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0];

    if (init?.method === "PATCH") {
      isReceived = true;

      return jsonResponse({ data: { id: "pur-1", status: "recibido" } });
    }

    const queue = isReceived ? [REVIEW_ITEM] : [];

    if (path === "/api/products/price-review/summary") {
      return jsonResponse({ data: { total: queue.length } });
    }

    if (path === "/api/products/price-review") {
      return jsonResponse({ data: { items: queue, limit: 100, skip: 0, total: queue.length } });
    }

    if (path === "/api/settings/pricing") {
      return jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
    }

    if (path === "/api/products") {
      return jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    }

    return jsonResponse({ data: { currentCostRef: isReceived ? 9 : 8, id: "prod-1" } });
  });
  global.fetch = fetchMock;
});

describe("useReceivePurchase · cola «Por revisar»", () => {
  it("tras recibir, el aviso del detalle vuelve a pedir la cola de la compra y pinta la fila sin recargar", async () => {
    // Caché fresca como en la app (30 s): sin invalidar, nada se vuelve a pedir.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    const user = userEvent.setup({ delay: null });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PurchaseDetailHarness />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("summary")).toHaveTextContent("0"));
    await waitFor(() => expect(gets("/api/products/price-review")).toBe(1));
    await waitFor(() => expect(gets("/api/products")).toBe(1));
    await waitFor(() => expect(gets("/api/products/prod-1")).toBe(1));
    expect(screen.queryByTestId("purchase-reprice-row-prod-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recibir pedido" }));

    const row = within(await screen.findByTestId("purchase-reprice-row-prod-1"));

    expect(row.getByRole("link", { name: "Harina PAN 1 kg" })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]: [string]) =>
        url.startsWith("/api/products/price-review?"),
      ).at(-1)?.[0],
    ).toBe("/api/products/price-review?limit=100&purchaseId=pur-1");
    // Contador del filtro y tarjeta del dashboard, lista `?review=1` y detalle del producto.
    await waitFor(() => expect(screen.getByTestId("summary")).toHaveTextContent("1"));
    await waitFor(() => expect(gets("/api/products")).toBe(2));
    await waitFor(() => expect(gets("/api/products/prod-1")).toBe(2));
  });
});
