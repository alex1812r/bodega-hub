/**
 * COM-14 · «Desarmar al recibir» en el detalle de compra: la confirmación de
 * recepción muestra los dos efectos de la línea marcada, deja marcarla o
 * desmarcarla y envía la lista de líneas a desarmar con su clave de idempotencia;
 * la tabla de ítems dice si la línea se desarmará o ya se desarmó.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-com14",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
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
import { getRolePermissions } from "@/shared/auth/permissions";
import type { ProductMock } from "@/shared/mocks/erp-data";

import type { PurchaseDetails } from "../hooks/usePurchases";
import { PurchaseDetailsPage } from "./page";

const RECEIVE = "Recibir mercancía";
const SWITCH = "Desarmar al recibir";
const PT409 =
  "Sin receta de apertura activa: Caja de refrescos. Desmarca «Desarmar al recibir» en esas líneas o activa su receta";

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
  purchaseId: "purchase-com14",
  quantity: 3,
  subtotalRef: 27,
  subtotalVes: 13500,
  unitCostRef: 9,
  unitCostVes: 4500,
};

const LOOSE: Item = {
  disassembled: false,
  disassembleOnReceive: false,
  entryMode: "unit",
  id: "item-harina",
  product: product({ currentStock: 10, id: "prod-harina", name: "Harina PAN" }),
  productId: "prod-harina",
  purchaseId: "purchase-com14",
  quantity: 5,
  subtotalRef: 10,
  subtotalVes: 5000,
  unitCostRef: 2,
  unitCostVes: 1000,
};

const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-08T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-com14",
  items: [BOX, LOOSE],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-20261008-000014",
  refRateVes: 500,
  status: "pedido",
  subtotalRef: 37,
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 37,
  totalVes: 18500,
  userId: "user-admin",
};

type ReceiveBody = { clientRequestId?: string; disassemble?: Array<{ purchaseItemId: string }> };

function installApi(initial: Partial<PurchaseDetails>, failures: number) {
  let purchase: PurchaseDetails = { ...PURCHASE, ...initial };
  let remainingFailures = failures;
  const receiveBodies: Array<ReceiveBody | null> = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "PATCH" && url === `/api/purchases/${PURCHASE.id}/receive`) {
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as ReceiveBody) : null;

      receiveBodies.push(body);

      if (remainingFailures > 0) {
        remainingFailures -= 1;

        return Promise.resolve(jsonResponse({ error: { code: "CONFLICT", message: PT409 } }, 409));
      }

      const disassembled = new Set((body?.disassemble ?? []).map((entry) => entry.purchaseItemId));

      purchase = {
        ...purchase,
        // Una compra recibida ya no trae la receta de sus líneas.
        items: purchase.items.map((item) => ({
          ...item,
          packRecipe: undefined,
          disassembled: disassembled.has(item.id ?? ""),
          disassembleOnReceive: disassembled.has(item.id ?? ""),
        })),
        status: "recibido",
      };

      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url === `/api/purchases/${PURCHASE.id}`) {
      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url.includes("/api/auth/me")) {
      return Promise.resolve(
        jsonResponse({ data: { permissions: getRolePermissions("admin"), role: "admin" } }),
      );
    }

    return Promise.resolve(jsonResponse({ data: null }));
  }) as unknown as typeof fetch;

  return { receiveBodies };
}

async function renderPage(initial: Partial<PurchaseDetails> = {}, failures = 0) {
  const api = installApi(initial, failures);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseDetailsPage purchaseId={PURCHASE.id} />
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: /C-20261008-000014/ });
  await waitFor(() =>
    expect(queryClient.getQueryState(authQueryKeys.me())?.status).toBe("success"),
  );

  return { ...api, user: userEvent.setup() };
}

async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: RECEIVE }));

  return screen.findByRole("dialog", { name: RECEIVE });
}

function lineOf(dialog: HTMLElement, name: string) {
  const row = within(dialog)
    .getAllByRole("listitem")
    .find((candidate) => candidate.querySelector("p")?.textContent === name);

  if (!row) {
    throw new Error(`La previsualización no tiene la línea ${name}`);
  }

  return row;
}

describe("PurchaseDetailsPage · ítems con desarme (COM-14)", () => {
  it("pedido: la línea marcada dice «Se desarmará al recibir»; la que no, nada", async () => {
    await renderPage();

    const table = screen.getByRole("table");

    expect(within(table).getByText("Se desarmará al recibir")).toBeInTheDocument();
    expect(within(table).getAllByText(/desarm/i)).toHaveLength(1);
  });

  it("compra recibida: la línea desarmada dice «Desarmado al recibir»", async () => {
    await renderPage({ items: [{ ...BOX, disassembled: true, packRecipe: undefined }, LOOSE], status: "recibido" });

    expect(within(screen.getByRole("table")).getByText("Desarmado al recibir")).toBeInTheDocument();
    expect(screen.queryByText("Se desarmará al recibir")).not.toBeInTheDocument();
  });

  it("pedido cancelado con la línea marcada: no promete un desarme que no ocurrirá", async () => {
    await renderPage({ status: "cancelado" });

    expect(screen.queryByText(/desarm/i)).not.toBeInTheDocument();
  });
});

describe("PurchaseDetailsPage · confirmación de recepción con desarme (COM-14)", () => {
  it("muestra los dos efectos de la línea marcada: el empaque entra y sale, y lo que sube cada componente", async () => {
    const { receiveBodies, user } = await renderPage();
    const dialog = await openPreview(user);
    const box = lineOf(dialog, "Caja de refrescos");

    expect(within(box).getByRole("switch", { name: SWITCH })).toBeChecked();
    expect(within(box).getByText("−3 empaques")).toBeInTheDocument();
    // El empaque queda como estaba: 2 → 2.
    expect(within(box).getAllByText("2 un")).toHaveLength(2);

    const components = within(box).getByRole("list", {
      name: "Componentes que entran al desarmar Caja de refrescos",
    });

    expect(within(components).getByText("Refresco 355 ml")).toBeInTheDocument();
    expect(within(components).getByText("+18 un")).toBeInTheDocument();
    expect(within(components).getByText("4 un")).toBeInTheDocument();
    expect(within(components).getByText("22 un")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/los empaques marcados se abrirán en sus componentes/),
    ).toBeInTheDocument();
    // La línea sin receta no ofrece el interruptor.
    expect(within(lineOf(dialog, "Harina PAN")).queryByRole("switch")).not.toBeInTheDocument();
    expect(receiveBodies).toHaveLength(0);
  });

  it("confirmar envía la línea a desarmar con una clave de idempotencia y la tabla pasa a «Desarmado al recibir»", async () => {
    const { receiveBodies, user } = await renderPage();
    const dialog = await openPreview(user);

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(receiveBodies).toEqual([
      {
        clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        disassemble: [{ purchaseItemId: "item-caja" }],
      },
    ]);
    expect(await screen.findByText("Desarmado al recibir")).toBeInTheDocument();
  });

  it("desmarcar la línea quita el segundo efecto, el stock del empaque sube y se envía la lista vacía", async () => {
    const { receiveBodies, user } = await renderPage();
    const dialog = await openPreview(user);
    const box = lineOf(dialog, "Caja de refrescos");

    await user.click(within(box).getByRole("switch", { name: SWITCH }));

    expect(within(box).getByRole("switch", { name: SWITCH })).not.toBeChecked();
    expect(within(box).queryByText("−3 empaques")).not.toBeInTheDocument();
    expect(within(box).getByText("5 un")).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/los empaques marcados se abrirán/),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]?.disassemble).toEqual([]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/desarm/i)).not.toBeInTheDocument();
  });

  it("marcar una línea que el pedido no tenía marcada la desarma", async () => {
    const { receiveBodies, user } = await renderPage({ items: [{ ...BOX, disassembleOnReceive: false }, LOOSE] });
    const dialog = await openPreview(user);
    const box = lineOf(dialog, "Caja de refrescos");

    expect(within(box).getByRole("switch", { name: SWITCH })).not.toBeChecked();

    await user.click(within(box).getByRole("switch", { name: SWITCH }));

    expect(within(box).getByText("+18 un")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]?.disassemble).toEqual([{ purchaseItemId: "item-caja" }]);
  });

  it("compra sin ninguna línea con receta: la recepción viaja sin lista (la de siempre)", async () => {
    const { receiveBodies, user } = await renderPage({ items: [LOOSE] });
    const dialog = await openPreview(user);

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]).toEqual({ clientRequestId: expect.any(String) });
  });

  it("si la base rechaza el desarme el mensaje se muestra tal cual, nada se cierra y, tras desmarcar, se puede recibir", async () => {
    const { receiveBodies, user } = await renderPage({}, 1);
    const dialog = await openPreview(user);

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    expect(await within(dialog).findByText(PT409)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: RECEIVE })).toBeInTheDocument();

    await user.click(within(lineOf(dialog, "Caja de refrescos")).getByRole("switch", { name: SWITCH }));
    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(2));
    expect(receiveBodies.map((body) => body?.disassemble)).toEqual([[{ purchaseItemId: "item-caja" }], []]);
    // Un 409 es de resultado incierto para el formulario: la clave del intento se
    // conserva. La base no la guardó (revirtió toda la recepción), así que la acepta.
    expect(receiveBodies[1]?.clientRequestId).toBe(receiveBodies[0]?.clientRequestId);
  });

  it("línea marcada cuyo producto ya no tiene receta: avisa que se recibirá sin desarmar y envía la lista vacía", async () => {
    const { receiveBodies, user } = await renderPage({ items: [{ ...BOX, packRecipe: undefined }, LOOSE] });
    const dialog = await openPreview(user);
    const box = lineOf(dialog, "Caja de refrescos");

    expect(
      within(box).getByText("Su receta de apertura ya no está activa: se recibirá sin desarmar"),
    ).toBeInTheDocument();
    expect(within(box).queryByRole("switch")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]?.disassemble).toEqual([]);
  });
});
