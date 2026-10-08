/**
 * COM-F4 · «Recibir mercancía…» de la lista no recibe: abre el detalle con
 * `?receive=1`, que muestra la previsualización de la recepción y quita el
 * parámetro de la URL sin perder `returnTo`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-f4",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aquí.
jest.mock("./services/exportPurchaseDetailPdf", () => ({
  exportPurchaseDetailPdf: jest.fn(),
}));

jest.mock("../../products/components/price-review/PurchaseRepriceNotice", () => ({
  PurchaseRepriceNotice: () => null,
}));

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { type Permission, getRolePermissions } from "@/shared/auth/permissions";

import type { PurchaseDetails } from "../hooks/usePurchases";
import { PurchaseDetailsPage } from "./page";

const RECEIVE = "Recibir mercancía";
const NOTICE = "El inventario no ha cambiado.";
const RETURN_TO = "returnTo=%2Fpurchases%3Fstatus%3Dpedido%26pendingBalance%3D1";

const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-06T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-f4",
  items: [
    {
      entryMode: "unit",
      product: {
        categoryId: "cat-1",
        currentCostRef: 2,
        currentStock: 10,
        id: "prod-harina",
        isActive: true,
        minStock: 0,
        name: "Harina PAN",
        salePriceRef: 3,
        sku: "HAR",
      },
      productId: "prod-harina",
      purchaseId: "purchase-f4",
      quantity: 5,
      subtotalRef: 10,
      subtotalVes: 5000,
      unitCostRef: 2,
      unitCostVes: 1000,
    },
  ],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-20261008-000004",
  refRateVes: 500,
  status: "pedido",
  subtotalRef: 10,
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 10,
  totalVes: 5000,
  userId: "user-admin",
};

const ADMIN = getRolePermissions("admin");
const WITHOUT_RECEIVE = ADMIN.filter((permission) => permission !== "purchases.create");

async function renderAt(
  query: string,
  {
    permissions = ADMIN,
    status = "pedido",
  }: { permissions?: readonly Permission[]; status?: PurchaseDetails["status"] } = {},
) {
  const receiveCalls: string[] = [];

  window.history.replaceState(null, "", `/purchases/${PURCHASE.id}${query ? `?${query}` : ""}`);

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "PATCH") {
      receiveCalls.push(url);
    }

    if (url === `/api/purchases/${PURCHASE.id}`) {
      return Promise.resolve(jsonResponse({ data: { ...PURCHASE, status } }));
    }

    if (url.includes("/api/auth/me")) {
      return Promise.resolve(jsonResponse({ data: { permissions, role: "admin" } }));
    }

    return Promise.resolve(jsonResponse({ data: null }));
  }) as unknown as typeof fetch;

  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseDetailsPage purchaseId={PURCHASE.id} />
    </QueryClientProvider>,
  );

  // Con la previsualización abierta el detalle queda oculto a la accesibilidad.
  await screen.findByRole("heading", { hidden: true, name: /C-20261008-000004/ });
  await waitFor(() =>
    expect(queryClient.getQueryState(authQueryKeys.me())?.status).toBe("success"),
  );

  return { receiveCalls, user: userEvent.setup() };
}

describe("PurchaseDetailsPage · llegada con ?receive=1 (COM-F4)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("pedido con permiso: abre la previsualización sin recibir nada y limpia el parámetro conservando returnTo", async () => {
    const { receiveCalls } = await renderAt(`receive=1&${RETURN_TO}`);
    const dialog = await screen.findByRole("dialog", { name: RECEIVE });

    expect(within(dialog).getByText("Harina PAN")).toBeInTheDocument();
    expect(within(dialog).getByText("15 un")).toBeInTheDocument();
    expect(receiveCalls).toHaveLength(0);
    await waitFor(() => expect(window.location.search).toBe(`?${RETURN_TO}`));
    expect(window.location.pathname).toBe(`/purchases/${PURCHASE.id}`);
  });

  it("cerrada la previsualización no vuelve a abrirse sola y nada se recibió", async () => {
    const { receiveCalls, user } = await renderAt("receive=1");
    const dialog = await screen.findByRole("dialog", { name: RECEIVE });

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.search).toBe("");
    expect(receiveCalls).toHaveLength(0);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it.each(["recibido", "cancelado", "devuelto"] as const)(
    "compra en estado %s: ignora el parámetro, no abre nada y lo quita de la URL",
    async (status) => {
      const { receiveCalls } = await renderAt(`receive=1&${RETURN_TO}`, { status });

      await waitFor(() => expect(window.location.search).toBe(`?${RETURN_TO}`));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(receiveCalls).toHaveLength(0);
    },
  );

  it("sin permiso de recibir: no abre la previsualización", async () => {
    const { receiveCalls } = await renderAt(`receive=1&${RETURN_TO}`, {
      permissions: WITHOUT_RECEIVE,
    });

    await waitFor(() => expect(window.location.search).toBe(`?${RETURN_TO}`));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(receiveCalls).toHaveLength(0);
  });

  it("sin el parámetro, o con otro valor, el detalle abre como siempre", async () => {
    await renderAt(`receive=0&${RETURN_TO}`);

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.search).toBe(`?receive=0&${RETURN_TO}`);
  });

  it("el botón «Volver» sigue llevando a la lista de origen", async () => {
    await renderAt(`receive=1&${RETURN_TO}`, { status: "recibido" });

    await waitFor(() => expect(window.location.search).toBe(`?${RETURN_TO}`));
    expect(screen.getByRole("link", { name: /Volver/ })).toHaveAttribute(
      "href",
      "/purchases?status=pedido&pendingBalance=1",
    );
  });
});
