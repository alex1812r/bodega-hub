/**
 * COM-07 · estado «Pedido» explícito en el detalle de compra: aviso fijo con la
 * acción «Recibir mercancía», previsualización de lo que entra al inventario y
 * recepción en un solo envío.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-com07",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aquí.
jest.mock("./services/exportPurchaseDetailPdf", () => ({
  exportPurchaseDetailPdf: jest.fn(),
}));

// PRO-10: el aviso tiene su propia suite; aquí solo importa que siga montado.
jest.mock("../../products/components/price-review/PurchaseRepriceNotice", () => ({
  PurchaseRepriceNotice: ({ purchaseId }: { purchaseId: string }) => (
    <div data-purchase-id={purchaseId} data-testid="purchase-reprice-notice" />
  ),
}));

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { type Permission, type UserRole, getRolePermissions } from "@/shared/auth/permissions";
import type { ProductMock } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";

import type { PurchaseDetails } from "../hooks/usePurchases";
import { PurchaseDetailsPage } from "./page";

const NOTICE = "El inventario no ha cambiado.";
const RECEIVE = "Recibir mercancía";
const INACTIVE = "Producto inactivo: se recibirá igualmente";
const PT409 = "Solo se pueden recibir compras en estado pedido";

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

const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-06T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-com07",
  items: [
    {
      entryMode: "unit",
      product: product({ currentStock: 10, id: "prod-harina", name: "Harina PAN" }),
      productId: "prod-harina",
      purchaseId: "purchase-com07",
      quantity: 5,
      subtotalRef: 10,
      subtotalVes: 5000,
      unitCostRef: 2,
      unitCostVes: 1000,
    },
    {
      entryMode: "pack",
      packCount: 3,
      packLabel: "caja",
      product: product({
        currentStock: 4,
        id: "prod-malta",
        isActive: false,
        name: "Malta Maltín",
      }),
      productId: "prod-malta",
      purchaseId: "purchase-com07",
      quantity: 36,
      subtotalRef: 27,
      subtotalVes: 13500,
      unitCostRef: 0.75,
      unitCostVes: 375,
      unitsPerPack: 12,
    },
  ],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-20261008-000003",
  refRateVes: 500,
  status: "pedido",
  subtotalRef: 37,
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 37,
  totalVes: 18500,
  userId: "user-admin",
};

type Session = { permissions?: readonly Permission[]; role: UserRole };

type ReceiveBehaviour =
  /** La recepción se resuelve cuando el test llama a `release`. */
  | { kind: "deferred" }
  /** Otra persona ya la recibió: el servidor responde PT409 y la compra está recibida. */
  | { kind: "already-received" }
  | { kind: "ok" };

function installApi(
  initial: Partial<PurchaseDetails>,
  session: Session,
  behaviour: ReceiveBehaviour,
) {
  let purchase: PurchaseDetails = { ...PURCHASE, ...initial };
  let purchaseGets = 0;
  const receiveCalls: string[] = [];
  const pending: Array<() => void> = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "PATCH" && url === `/api/purchases/${PURCHASE.id}/receive`) {
      receiveCalls.push(url);
      purchase = { ...purchase, status: "recibido" };

      if (behaviour.kind === "already-received") {
        return Promise.resolve(
          jsonResponse({ error: { code: "CONFLICT", message: PT409 } }, 409),
        );
      }

      if (behaviour.kind === "deferred") {
        return new Promise<Response>((resolve) => {
          pending.push(() => resolve(jsonResponse({ data: purchase })));
        });
      }

      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url === `/api/purchases/${PURCHASE.id}`) {
      purchaseGets += 1;

      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url.includes("/api/auth/me")) {
      return Promise.resolve(
        jsonResponse({
          data: {
            permissions: session.permissions ?? getRolePermissions(session.role),
            role: session.role,
          },
        }),
      );
    }

    return Promise.resolve(jsonResponse({ data: null }));
  }) as unknown as typeof fetch;

  return {
    purchaseGets: () => purchaseGets,
    receiveCalls,
    release: () => pending.splice(0).forEach((resolve) => resolve()),
  };
}

async function renderPage(
  initial: Partial<PurchaseDetails> = {},
  session: Session = { role: "admin" },
  behaviour: ReceiveBehaviour = { kind: "ok" },
) {
  const api = installApi(initial, session, behaviour);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseDetailsPage purchaseId={PURCHASE.id} />
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: /C-20261008-000003/ });
  await waitFor(() =>
    expect(queryClient.getQueryState(authQueryKeys.me())?.status).toBe("success"),
  );

  return { ...api, user: userEvent.setup() };
}

const WITHOUT_RECEIVE: Session = {
  permissions: getRolePermissions("admin").filter(
    (permission) => permission !== "purchases.create",
  ),
  role: "admin",
};

async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: RECEIVE }));

  return screen.findByRole("dialog", { name: RECEIVE });
}

describe("PurchaseDetailsPage · aviso de pedido sin recibir (COM-07)", () => {
  it("en estado pedido y con permiso de recibir: aviso con la acción «Recibir mercancía»", async () => {
    await renderPage();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RECEIVE })).toBeInTheDocument();
  });

  it("va arriba del detalle, antes de la cabecera de la compra", async () => {
    await renderPage();

    const notice = screen.getByText(NOTICE);
    const heading = screen.getByRole("heading", { name: /C-20261008-000003/ });

    expect(
      notice.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sin permiso de recibir: el aviso sigue, sin botón", async () => {
    await renderPage({}, WITHOUT_RECEIVE);

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
  });

  it.each(["recibido", "cancelado", "devuelto"] as const)(
    "compra en estado %s: ni aviso ni botón",
    async (status) => {
      await renderPage({ status });

      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
    },
  );

  it("el menú de acciones ya no repite la acción de recibir", async () => {
    const { user } = await renderPage();

    await user.click(screen.getByRole("button", { name: /^Acciones de/ }));

    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);

    expect(items).toContain("Descargar PDF");
    expect(items.some((label) => /recibir/i.test(label ?? ""))).toBe(false);
  });
});

describe("PurchaseDetailsPage · previsualización al recibir (COM-07)", () => {
  it("lista por línea lo que entra, el stock antes → después y el costo unitario, sin enviar nada", async () => {
    const { receiveCalls, user } = await renderPage();
    const dialog = await openPreview(user);
    const [unitLine, packLine] = within(
      within(dialog).getByRole("list", { name: "Mercancía que entra" }),
    ).getAllByRole("listitem");

    // Línea por unidad.
    expect(within(unitLine).getByText("Harina PAN")).toBeInTheDocument();
    expect(within(unitLine).getByText("5 un")).toBeInTheDocument();
    expect(within(unitLine).getByText("10 un")).toBeInTheDocument();
    expect(within(unitLine).getByText("15 un")).toBeInTheDocument();
    expect(within(unitLine).getByText(formatRefUsd(2))).toBeInTheDocument();

    // Línea por empaque: empaques × unidades = unidades totales.
    expect(within(packLine).getByText("Malta Maltín")).toBeInTheDocument();
    expect(within(packLine).getByText("3 × 12 = 36 un")).toBeInTheDocument();
    expect(within(packLine).getByText("4 un")).toBeInTheDocument();
    expect(within(packLine).getByText("40 un")).toBeInTheDocument();
    expect(within(packLine).getByText(formatRefUsd(0.75))).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: RECEIVE })).toBeInTheDocument();
    expect(receiveCalls).toHaveLength(0);
  });

  it("avisa solo en la línea cuyo producto está inactivo", async () => {
    const { user } = await renderPage();
    const dialog = await openPreview(user);
    const [activeLine, inactiveLine] = within(dialog).getAllByRole("listitem");

    expect(within(inactiveLine).getByText(INACTIVE)).toBeInTheDocument();
    expect(within(activeLine).queryByText(INACTIVE)).not.toBeInTheDocument();
  });

  it("«Cancelar» cierra sin recibir y el aviso sigue", async () => {
    const { receiveCalls, user } = await renderPage();
    const dialog = await openPreview(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(receiveCalls).toHaveLength(0);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("confirmar recibe: el modal se cierra, el aviso desaparece, el estado pasa a recibido y el aviso de reprecio sigue", async () => {
    const { receiveCalls, user } = await renderPage();
    const dialog = await openPreview(user);

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(receiveCalls).toHaveLength(1);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
    expect(await screen.findByText("Recibido")).toBeInTheDocument();
    expect(screen.getByTestId("purchase-reprice-notice")).toHaveAttribute(
      "data-purchase-id",
      PURCHASE.id,
    );
  });

  it("pulsar dos veces «Recibir mercancía» envía una sola recepción y bloquea el modal mientras tanto", async () => {
    const { receiveCalls, release, user } = await renderPage({}, { role: "admin" }, {
      kind: "deferred",
    });
    const dialog = await openPreview(user);
    const confirm = within(dialog).getByRole("button", { name: RECEIVE });

    // Dos clics en el mismo tick, antes de que React deshabilite el botón.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(receiveCalls).toHaveLength(1));

    const busy = within(dialog).getByRole("button", { name: /Procesando/ });

    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();

    await user.click(busy);
    expect(receiveCalls).toHaveLength(1);

    release();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(receiveCalls).toHaveLength(1);
  });

  it("recibir una compra ya recibida: el PT409 se ve tal cual en el modal y el detalle se refresca", async () => {
    const { purchaseGets, receiveCalls, user } = await renderPage({}, { role: "admin" }, {
      kind: "already-received",
    });
    const getsBefore = purchaseGets();
    const dialog = await openPreview(user);

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(PT409);
    expect(receiveCalls).toHaveLength(1);

    // El detalle se volvió a pedir: la compra ya está recibida y el aviso se va,
    // pero el modal sigue abierto con el error y lo que se intentó recibir.
    await waitFor(() => expect(purchaseGets()).toBeGreaterThan(getsBefore));
    await waitFor(() => expect(screen.queryByText(NOTICE)).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: RECEIVE })).toBeInTheDocument();
    expect(within(dialog).getByText("3 × 12 = 36 un")).toBeInTheDocument();
    expect(screen.getAllByText(PT409)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(PT409)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECEIVE })).not.toBeInTheDocument();
  });
});
