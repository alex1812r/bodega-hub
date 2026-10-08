/**
 * COM-14 · reparto ajustable del surtido en la confirmación de recepción (plan
 * ux-mejoras, flujo 11): compra de 3 cajas surtidas 2-2-2 con «Desarmar al
 * recibir»; al recibir se ajusta una caja a 3-1-2 y la confirmación muestra −3
 * cajas, +7 Cola, +5 Manzana, +6 Naranja y envía ese reparto. Un reparto que no
 * suma bloquea «Recibir mercancía» con el mensaje del control.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-com14b",
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
import { receivePurchaseBodySchema } from "../services/purchaseDisassemble";
import { PurchaseDetailsPage } from "./page";

const RECEIVE = "Recibir mercancía";
const ADJUST = "Ajustar reparto de Caja surtida";
const SHORT = "Faltan 1 unidad(es) por repartir: el reparto debe sumar 18.";

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

/** 3 cajas surtidas de 6: 2 Cola + 2 Manzana + 2 Naranja por caja. */
const ASSORTED: Item = {
  disassembled: false,
  disassembleOnReceive: true,
  entryMode: "unit",
  id: "item-surtida",
  packRecipe: {
    components: [
      { currentStock: 4, isActive: true, name: "Cola", unitProductId: "prod-cola", unitsPerPack: 2 },
      { currentStock: 0, isActive: true, name: "Manzana", unitProductId: "prod-manzana", unitsPerPack: 2 },
      { currentStock: 1, isActive: true, name: "Naranja", unitProductId: "prod-naranja", unitsPerPack: 2 },
    ],
    conversionId: "rec-surtida",
    totalUnits: 6,
  },
  product: product({ currentStock: 0, id: "prod-surtida", name: "Caja surtida" }),
  productId: "prod-surtida",
  purchaseId: "purchase-com14b",
  quantity: 3,
  subtotalRef: 36,
  subtotalVes: 18000,
  unitCostRef: 12,
  unitCostVes: 6000,
};

/** Empaque de receta simple (un solo componente): no hay nada que repartir. */
const SIMPLE: Item = {
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
  purchaseId: "purchase-com14b",
  quantity: 3,
  subtotalRef: 27,
  subtotalVes: 13500,
  unitCostRef: 9,
  unitCostVes: 4500,
};

const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-08T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-com14b",
  items: [ASSORTED, SIMPLE],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-20261008-000015",
  refRateVes: 500,
  status: "pedido",
  subtotalRef: 63,
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 63,
  totalVes: 31500,
  userId: "user-admin",
};

function installApi() {
  let purchase: PurchaseDetails = PURCHASE;
  const receiveBodies: unknown[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "PATCH" && url === `/api/purchases/${PURCHASE.id}/receive`) {
      receiveBodies.push(typeof init.body === "string" ? JSON.parse(init.body) : null);
      purchase = {
        ...purchase,
        items: purchase.items.map((item) => ({ ...item, disassembled: true, packRecipe: undefined })),
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

async function openPreview() {
  const api = installApi();
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseDetailsPage purchaseId={PURCHASE.id} />
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: /C-20261008-000015/ });
  await waitFor(() =>
    expect(queryClient.getQueryState(authQueryKeys.me())?.status).toBe("success"),
  );
  await user.click(screen.getByRole("button", { name: RECEIVE }));

  return { ...api, dialog: await screen.findByRole("dialog", { name: RECEIVE }), user };
}

function effectsOf(dialog: HTMLElement, name: string) {
  const list = within(dialog).getByRole("list", {
    name: `Componentes que entran al desarmar ${name}`,
  });

  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.textContent?.replace(/\s+/g, " ").trim());
}

async function type(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string, text: string) {
  const field = within(dialog).getByRole("textbox", { name: `Unidades de ${name}` });

  await user.clear(field);
  if (text) {
    await user.type(field, text);
  }
}

describe("PurchaseDetailsPage · reparto ajustable del surtido al recibir (COM-14)", () => {
  it("solo el surtido que se desarma ofrece «Ajustar reparto»; la receta simple, no", async () => {
    const { dialog } = await openPreview();

    expect(within(dialog).getByRole("button", { name: ADJUST })).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog).queryByRole("button", { name: "Ajustar reparto de Caja de refrescos" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: /Reparto de/ })).not.toBeInTheDocument();
    expect(effectsOf(dialog, "Caja surtida")).toEqual([
      "Cola+6 un4 unpasa a10 un",
      "Manzana+6 un0 unpasa a6 un",
      "Naranja+6 un1 unpasa a7 un",
    ]);
  });

  it("abre con el reparto de la receta × empaques de la línea (6 / 6 / 6 de 18)", async () => {
    const { dialog, user } = await openPreview();

    await user.click(within(dialog).getByRole("button", { name: ADJUST }));

    const group = within(dialog).getByRole("group", { name: "Reparto de 3 empaques" });

    expect(
      ["Cola", "Manzana", "Naranja"].map(
        (name) => (within(group).getByRole("textbox", { name: `Unidades de ${name}` }) as HTMLInputElement).value,
      ),
    ).toEqual(["6", "6", "6"]);
    expect(within(group).getByText("18 de 18 unidades")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Restablecer receta" })).toBeDisabled();
  });

  it("una caja a 3-1-2: la confirmación muestra −3 cajas, +7 Cola, +5 Manzana, +6 Naranja y envía ese reparto", async () => {
    const { dialog, receiveBodies, user } = await openPreview();

    await user.click(within(dialog).getByRole("button", { name: ADJUST }));
    await type(user, dialog, "Cola", "7");
    await type(user, dialog, "Manzana", "5");

    expect(within(dialog).getByText("18 de 18 unidades")).toBeInTheDocument();
    expect(within(dialog).getAllByText("−3 empaques")).toHaveLength(2);
    expect(effectsOf(dialog, "Caja surtida")).toEqual([
      "Cola+7 un4 unpasa a11 un",
      "Manzana+5 un0 unpasa a5 un",
      "Naranja+6 un1 unpasa a7 un",
    ]);
    expect(within(dialog).getByText("Reparto ajustado")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(receiveBodies).toEqual([
      {
        clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        disassemble: [
          {
            distribution: [
              { unitProductId: "prod-cola", units: 7 },
              { unitProductId: "prod-manzana", units: 5 },
              { unitProductId: "prod-naranja", units: 6 },
            ],
            purchaseItemId: "item-surtida",
          },
          { purchaseItemId: "item-caja" },
        ],
      },
    ]);
    // Es el cuerpo que valida la ruta de recepción.
    expect(receivePurchaseBodySchema.safeParse(receiveBodies[0]).success).toBe(true);
  });

  it("reparto que no suma: el control dice cuánto falta, «Recibir mercancía» no envía nada y repite el motivo", async () => {
    const { dialog, receiveBodies, user } = await openPreview();

    await user.click(within(dialog).getByRole("button", { name: ADJUST }));
    await type(user, dialog, "Naranja", "5");

    const group = within(dialog).getByRole("group", { name: "Reparto de 3 empaques" });

    expect(within(group).getByText(SHORT)).toBeInTheDocument();
    expect(within(group).getByText("17 de 18 unidades")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    expect(await within(dialog).findByText(`Caja surtida: ${SHORT}`)).toBeInTheDocument();
    expect(receiveBodies).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: RECEIVE })).toBeInTheDocument();

    // Con el reparto inválido el control no se puede ocultar.
    expect(within(dialog).getByRole("button", { name: "Ocultar reparto de Caja surtida" })).toBeDisabled();

    await type(user, dialog, "Cola", "7");

    await waitFor(() =>
      expect(within(dialog).queryByText(`Caja surtida: ${SHORT}`)).not.toBeInTheDocument(),
    );
    expect(within(group).queryByText(SHORT)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]).toMatchObject({
      disassemble: [
        {
          distribution: [
            { unitProductId: "prod-cola", units: 7 },
            { unitProductId: "prod-manzana", units: 6 },
            { unitProductId: "prod-naranja", units: 5 },
          ],
          purchaseItemId: "item-surtida",
        },
        { purchaseItemId: "item-caja" },
      ],
    });
  });

  it("un campo vacío reparte 0 y con decimales el reparto no vale", async () => {
    const { dialog, receiveBodies, user } = await openPreview();

    await user.click(within(dialog).getByRole("button", { name: ADJUST }));
    await type(user, dialog, "Manzana", "");

    expect(within(dialog).getByText("Faltan 6 unidad(es) por repartir: el reparto debe sumar 18.")).toBeInTheDocument();

    await type(user, dialog, "Manzana", "5.5");

    expect(
      within(dialog).getByText("Las unidades del reparto deben ser enteros mayores o iguales a cero."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    expect(receiveBodies).toHaveLength(0);
  });

  it("«Restablecer receta» vuelve a 6 / 6 / 6 y la línea viaja sin distribution", async () => {
    const { dialog, receiveBodies, user } = await openPreview();

    await user.click(within(dialog).getByRole("button", { name: ADJUST }));
    await type(user, dialog, "Cola", "9");
    await user.click(within(dialog).getByRole("button", { name: "Restablecer receta" }));

    expect(effectsOf(dialog, "Caja surtida")[0]).toBe("Cola+6 un4 unpasa a10 un");
    expect(within(dialog).queryByText("Reparto ajustado")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]).toMatchObject({
      disassemble: [{ purchaseItemId: "item-surtida" }, { purchaseItemId: "item-caja" }],
    });
    expect(receiveBodies[0]).not.toHaveProperty("disassemble.0.distribution");
  });

  it("desmarcar el surtido quita «Ajustar reparto» y su reparto inválido deja de bloquear", async () => {
    const { dialog, receiveBodies, user } = await openPreview();

    await user.click(within(dialog).getByRole("button", { name: ADJUST }));
    await type(user, dialog, "Naranja", "1");
    await user.click(within(dialog).getAllByRole("switch", { name: "Desarmar al recibir" })[0]!);

    expect(within(dialog).queryByRole("group", { name: /Reparto de/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /reparto de Caja surtida/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: RECEIVE }));

    await waitFor(() => expect(receiveBodies).toHaveLength(1));
    expect(receiveBodies[0]).toMatchObject({ disassemble: [{ purchaseItemId: "item-caja" }] });
  });
});
