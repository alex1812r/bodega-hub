/**
 * CNF-05 · en el detalle, «Cancelar» y «Devolver» pasan por su confirmación con
 * el efecto real (antes ejecutaban tras un texto genérico) y solo se ofrecen en
 * los estados que su RPC acepta. CNF-13 · el PDF se descarga sin confirmación.
 * CNF-04 · la recepción pide su efecto para la lista de desarme que va a enviar.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockSearch = "";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-cnf",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// jspdf necesita TextEncoder, que jsdom no trae.
jest.mock("./services/exportPurchaseDetailPdf", () => ({
  exportPurchaseDetailPdf: jest.fn(),
}));

jest.mock("../../products/components/price-review/PurchaseRepriceNotice", () => ({
  PurchaseRepriceNotice: () => null,
}));

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { type UserRole, getRolePermissions } from "@/shared/auth/permissions";
import type { ProductMock } from "@/shared/mocks/erp-data";

import {
  allowedPurchaseImpact,
  PURCHASE_PAYMENTS_BLOCKED_REASON,
  PURCHASE_STOCK_BLOCKED_REASON,
  purchaseImpactPaymentLine,
  receiveImpactOfUrl,
  rejectedPurchaseImpact,
} from "../components/purchaseImpact.testFixtures";
import type { PurchaseDetails } from "../hooks/usePurchases";
import type { PurchaseImpact } from "../services/purchaseImpact";
import { PurchaseDetailsPage } from "./page";
import { exportPurchaseDetailPdf } from "./services/exportPurchaseDetailPdf";

const RECEIVE = "Recibir mercancía";

function product(overrides: Partial<ProductMock>): ProductMock {
  return {
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 0,
    id: "prod",
    isActive: true,
    minStock: 0,
    name: "Producto",
    salePriceRef: 2,
    sku: "SKU",
    ...overrides,
  };
}

type Item = PurchaseDetails["items"][number];

const BOX: Item = {
  disassembled: false,
  disassembleOnReceive: true,
  entryMode: "unit",
  id: "item-caja",
  packRecipe: {
    components: [
      { currentStock: 4, isActive: true, name: "Refresco 355 ml", unitProductId: "prod-lata", unitsPerPack: 6 },
    ],
    conversionId: "rec-caja",
    totalUnits: 6,
  },
  product: product({ currentStock: 2, id: "prod-caja", name: "Caja de refrescos" }),
  productId: "prod-caja",
  purchaseId: "purchase-cnf",
  quantity: 3,
  subtotalRef: 27,
  subtotalVes: 13500,
  unitCostRef: 9,
  unitCostVes: 4500,
};

const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-06T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-cnf",
  items: [BOX],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-20261009-000007",
  refRateVes: 500,
  status: "recibido",
  subtotalRef: 27,
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 27,
  totalVes: 13500,
  userId: "user-admin",
};

type Api = {
  /** Efecto de cancelar / devolver; el de recibir se deriva de la compra y de la lista pedida. */
  impact?: PurchaseImpact;
  /** Mensaje con el que el servidor rechaza cancelar / devolver. */
  mutationFailure?: string;
  /** Mensaje con el que falla el cálculo del efecto de recibir. */
  receiveImpactFailure?: string;
  /** Efecto de recibir fijo (p. ej. un rechazo), en vez del derivado. */
  receiveImpact?: PurchaseImpact;
};

function installApi(initial: Partial<PurchaseDetails>, role: UserRole, api: Api) {
  let purchase: PurchaseDetails = { ...PURCHASE, ...initial };
  const writes: string[] = [];
  const impacts: string[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.split("?")[0];

    if (path === `/api/purchases/${PURCHASE.id}/impact`) {
      impacts.push(url);

      if (url.includes("action=receive")) {
        if (api.receiveImpactFailure) {
          return Promise.resolve(
            jsonResponse({ error: { code: "INTERNAL_ERROR", message: api.receiveImpactFailure } }, 500),
          );
        }

        return Promise.resolve(
          jsonResponse({ data: api.receiveImpact ?? receiveImpactOfUrl(url, purchase) }),
        );
      }

      return Promise.resolve(jsonResponse({ data: api.impact ?? allowedPurchaseImpact("cancel") }));
    }

    if (init?.method === "PATCH" || init?.method === "POST") {
      writes.push(`${init.method} ${url}`);

      if (api.mutationFailure) {
        return Promise.resolve(
          jsonResponse({ error: { code: "CONFLICT", message: api.mutationFailure } }, 409),
        );
      }

      if (path.endsWith("/return")) {
        purchase = { ...purchase, status: "devuelto" };

        return Promise.resolve(jsonResponse({ data: { purchase } }));
      }

      purchase = { ...purchase, status: path.endsWith("/cancel") ? "cancelado" : "recibido" };

      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url === `/api/purchases/${PURCHASE.id}`) {
      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url.includes("/api/auth/me")) {
      return Promise.resolve(
        jsonResponse({ data: { permissions: getRolePermissions(role), role } }),
      );
    }

    return Promise.resolve(jsonResponse({ data: null }));
  }) as unknown as typeof fetch;

  return { impacts, writes };
}

async function renderPage(
  initial: Partial<PurchaseDetails> = {},
  api: Api = {},
  role: UserRole = "admin",
) {
  const calls = installApi(initial, role, api);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseDetailsPage purchaseId={PURCHASE.id} />
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: /C-20261009-000007/ });
  await waitFor(() =>
    expect(queryClient.getQueryState(authQueryKeys.me())?.status).toBe("success"),
  );

  return { ...calls, user: userEvent.setup() };
}

async function menuLabels(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Acciones de/ }));

  return (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
}

async function openAction(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: /^Acciones de/ }));
  await user.click(await screen.findByRole("menuitem", { name: label }));
}

beforeEach(() => {
  mockSearch = "";
  jest.mocked(exportPurchaseDetailPdf).mockClear();
});

describe("PurchaseDetailsPage · acciones que se ofrecen según el estado (CNF-05)", () => {
  it("recibida: PDF, duplicar, devolver y cancelar", async () => {
    const { user } = await renderPage();

    expect(await menuLabels(user)).toEqual([
      "Descargar PDF",
      "Duplicar compra",
      "Devolver",
      "Cancelar",
    ]);
  });

  it("pedido: se puede cancelar pero no devolver (la RPC solo devuelve compras recibidas)", async () => {
    const { user } = await renderPage({ status: "pedido" });

    expect(await menuLabels(user)).toEqual(["Descargar PDF", "Duplicar compra", "Cancelar"]);
  });

  it.each(["cancelado", "devuelto"] as const)(
    "%s: no ofrece cancelar ni devolver; PDF y duplicar siguen",
    async (status) => {
      const { user } = await renderPage({ status });

      expect(await menuLabels(user)).toEqual(["Descargar PDF", "Duplicar compra"]);
    },
  );

  it("«Descargar PDF» es directo: sin diálogo de confirmación", async () => {
    const { user, writes } = await renderPage();

    await openAction(user, "Descargar PDF");

    await waitFor(() => expect(exportPurchaseDetailPdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writes).toEqual([]);
  });
});

describe("PurchaseDetailsPage · cancelar y devolver confirman con su efecto (CNF-05)", () => {
  it("«Cancelar» no cancela: pide el efecto y lo muestra; cerrar no ejecuta nada", async () => {
    const { impacts, user, writes } = await renderPage();

    await openAction(user, "Cancelar");

    const dialog = within(await screen.findByRole("dialog", { name: "Cancelar compra" }));

    expect(await dialog.findByText("Qué va a pasar")).toBeInTheDocument();
    expect(impacts).toEqual([`/api/purchases/${PURCHASE.id}/impact?action=cancel`]);
    expect(dialog.getByText("Recibido")).toBeInTheDocument();
    expect(dialog.getByText("Cancelado")).toBeInTheDocument();
    expect(
      within(dialog.getByRole("list", { name: "Productos que salen del inventario" })).getByRole(
        "listitem",
      ),
    ).toHaveTextContent("−5 un");
    expect(writes).toEqual([]);

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual([]);
  });

  it("confirmar cancela una sola vez aunque haya doble clic, cierra el modal y el detalle queda cancelado", async () => {
    const { user, writes } = await renderPage();

    await openAction(user, "Cancelar");

    const dialog = within(await screen.findByRole("dialog", { name: "Cancelar compra" }));
    const confirm = await dialog.findByRole("button", { name: "Cancelar compra" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual([`PATCH /api/purchases/${PURCHASE.id}/cancel`]);
    expect(
      await screen.findByText("Compra cancelada: ya no admite recepción ni pagos."),
    ).toBeInTheDocument();
  });

  it("«Devolver» pide el efecto de devolver y, al confirmar, devuelve una sola vez", async () => {
    const { impacts, user, writes } = await renderPage({}, { impact: allowedPurchaseImpact("return") });

    await openAction(user, "Devolver");

    const dialog = within(await screen.findByRole("dialog", { name: "Devolver compra" }));
    const confirm = await dialog.findByRole("button", { name: "Devolver compra" });

    expect(impacts).toEqual([`/api/purchases/${PURCHASE.id}/impact?action=return`]);
    expect(dialog.getByText("Devuelto")).toBeInTheDocument();

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual([`POST /api/purchases/${PURCHASE.id}/return`]);
  });

  it("si la RPC rechaza al ejecutar, el mensaje se ve tal cual dentro del modal y solo ahí", async () => {
    const { user, writes } = await renderPage({}, { mutationFailure: PURCHASE_STOCK_BLOCKED_REASON });

    await openAction(user, "Cancelar");

    const dialog = within(await screen.findByRole("dialog", { name: "Cancelar compra" }));

    await user.click(await dialog.findByRole("button", { name: "Cancelar compra" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(PURCHASE_STOCK_BLOCKED_REASON);
    expect(writes).toHaveLength(1);
    expect(screen.getAllByText(PURCHASE_STOCK_BLOCKED_REASON)).toHaveLength(1);

    // Al cerrar, el error no queda colgado en el detalle ni reaparece al reabrir.
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(PURCHASE_STOCK_BLOCKED_REASON)).not.toBeInTheDocument();
  });

  it("con un pago activo: bloqueada, sin botón, y el enlace a los pagos de la compra vuelve a este detalle con su returnTo", async () => {
    mockSearch = `returnTo=${encodeURIComponent("/purchases?status=recibido")}`;

    const { user, writes } = await renderPage(
      {},
      {
        impact: rejectedPurchaseImpact("cancel", PURCHASE_PAYMENTS_BLOCKED_REASON, {
          payments: [purchaseImpactPaymentLine()],
        }),
      },
    );

    await openAction(user, "Cancelar");

    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede cancelar la compra" }),
    );
    const href = dialog.getByRole("link", { name: "Ver pagos de la compra" }).getAttribute("href");
    const params = new URLSearchParams((href ?? "").split("?")[1]);

    expect(dialog.getByRole("alert")).toHaveTextContent(PURCHASE_PAYMENTS_BLOCKED_REASON);
    expect(dialog.getByRole("list", { name: "Pagos que lo impiden" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Cancelar compra" })).not.toBeInTheDocument();
    expect(href?.split("?")[0]).toBe("/payments");
    expect(params.get("purchaseId")).toBe(PURCHASE.id);
    expect(params.get("returnTo")).toBe(
      `/purchases/${PURCHASE.id}?returnTo=${encodeURIComponent("/purchases?status=recibido")}`,
    );
    expect(writes).toEqual([]);
  });

  it("almacén (no ve pagos de compras): bloqueada sin lista de pagos ni enlace", async () => {
    const { user } = await renderPage(
      {},
      {
        impact: rejectedPurchaseImpact("cancel", PURCHASE_PAYMENTS_BLOCKED_REASON, {
          paymentsRestricted: true,
        }),
      },
      "almacen",
    );

    await openAction(user, "Cancelar");

    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede cancelar la compra" }),
    );

    expect(dialog.getByRole("note")).toHaveTextContent("Tu usuario no ve los pagos de las compras.");
    expect(dialog.queryByRole("link")).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Cancelar compra" })).not.toBeInTheDocument();
  });
});

describe("PurchaseDetailsPage · la recepción pide su efecto real (CNF-04)", () => {
  function receiveLists(impacts: string[]) {
    return impacts.map((url) => {
      const params = new URL(url, "http://localhost").searchParams;

      return { action: params.get("action"), disassemble: params.get("disassemble") };
    });
  }

  async function openReceive(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: RECEIVE }));

    return within(await screen.findByRole("dialog", { name: RECEIVE }));
  }

  it("pide el efecto con la lista de desarme que va a enviar y lo vuelve a pedir al cambiar una marca", async () => {
    const { impacts, user, writes } = await renderPage({ status: "pedido" });
    const dialog = await openReceive(user);

    await dialog.findByRole("button", { name: RECEIVE });
    expect(receiveLists(impacts)).toEqual([
      { action: "receive", disassemble: JSON.stringify([{ purchaseItemId: "item-caja" }]) },
    ]);

    const effects = () => dialog.getByRole("list", { name: "Stock y costo por producto" });

    // Costo que se fija: el de la línea (1 → 9) y, con precio 2, la ganancia baja de banda.
    expect(effects()).toHaveTextContent("Costo que se fija (con IVA)");
    expect(effects()).toHaveTextContent("Ganancia: baja de banda");
    expect(effects()).toHaveTextContent("Refresco 355 ml+18 un");

    await user.click(dialog.getByRole("switch", { name: "Desarmar al recibir" }));

    await waitFor(() =>
      expect(receiveLists(impacts)).toEqual([
        { action: "receive", disassemble: JSON.stringify([{ purchaseItemId: "item-caja" }]) },
        { action: "receive", disassemble: "[]" },
      ]),
    );
    // Con el efecto nuevo ya no entra nada al componente y el empaque sube.
    await dialog.findByRole("button", { name: RECEIVE });
    expect(effects()).not.toHaveTextContent("Refresco 355 ml");
    expect(effects()).toHaveTextContent("Caja de refrescos+3 un");
    expect(writes).toEqual([]);
  });

  it("si el impact dice que la RPC rechazaría: bloqueada con el motivo y sin botón de recibir", async () => {
    const reason = "Stock insuficiente de empaque";
    const { user, writes } = await renderPage(
      { status: "pedido" },
      { receiveImpact: rejectedPurchaseImpact("receive", reason) },
    );
    const dialog = await openReceive(user);

    expect(await dialog.findByRole("alert")).toHaveTextContent(reason);
    expect(dialog.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("si el efecto no se puede calcular no deja recibir a ciegas", async () => {
    const { user, writes } = await renderPage(
      { status: "pedido" },
      { receiveImpactFailure: "No pudimos calcular el efecto" },
    );
    const dialog = await openReceive(user);

    expect(await dialog.findByRole("alert")).toHaveTextContent("No pudimos calcular el efecto");
    expect(dialog.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });
});
