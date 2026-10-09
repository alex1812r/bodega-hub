import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

/**
 * COM-14 · chip «Desarmar al recibir» en `/purchases/create`: solo lo ofrece la
 * línea de un producto que es el empaque de una receta de apertura activa; marcado,
 * la línea viaja con `disassembleOnReceive: true`; se guarda con el borrador.
 */

const mockPush = jest.fn();
const mockCatalog: PurchaseCatalogProduct[] = [
  {
    costWithTaxRef: 9,
    currentStock: 2,
    link: "none",
    name: "Caja de refrescos",
    packUnits: [],
    productId: "prod-caja",
    sku: "BEB-CAJ-006",
    taxRate: 0,
    unitCostRef: 9,
  },
  {
    costWithTaxRef: 1,
    currentStock: 9,
    link: "none",
    name: "Harina PAN",
    packUnits: [],
    productId: "prod-harina",
    sku: "HAR-PAN",
    taxRate: 0,
    unitCostRef: 1,
  },
];

const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    {
      code: "exento",
      id: "tax-exento",
      isActive: true,
      isDefault: false,
      isGlobal: true,
      label: "Exento",
      pct: 0,
      sortOrder: 10,
    },
  ],
  refetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 500 }, error: null }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("./hooks/usePurchaseProductSearch", () => ({
  usePurchaseProductSearch: () => ({ catalog: mockCatalog, error: null, isSearching: false }),
}));
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: ({ onSupplierChange }: { onSupplierChange: (id: string) => void }) => (
    <button onClick={() => onSupplierChange("cont-supplier")} type="button">
      elegir proveedor
    </button>
  ),
}));

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";

import { purchaseLockOnAddStorageKey } from "./hooks/usePurchaseLockOnAdd";
import { PurchaseCreatePage } from "./page";

/** CNF-01: «Confirmar Compra» abre la confirmación; la compra se envía con el botón del modal. */
function acceptConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: /^Registrar (compra|pedido)$/ }));
}
import { purchaseDraftStorageKey } from "./utils/purchaseDraftStorage";

const SESSION = { storeId: "store-1", userId: "user-1" };
const CHIP = "Desarmar al recibir Caja de refrescos";

/** Recetas activas de la tienda: la caja es el empaque de una de ellas. */
const RECIPES = [
  {
    id: "rec-caja",
    linkedProduct: { id: "prod-lata" },
    packProduct: { id: "prod-caja" },
    role: "pack",
    unitsPerPack: 6,
  },
];

type GetData = (url: string) => unknown;

const withRecipes: GetData = (url) => (url.includes("/api/inventory/pack-conversions") ? RECIPES : null);

function renderPage(getData: GetData = withRecipes) {
  const api = installFetchStub(getData);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));

  return api;
}

function addProduct(name: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar productos" }), {
    target: { value: "a" },
  });
  fireEvent.click(
    within(screen.getByRole("list", { name: "Productos encontrados" })).getByRole("button", {
      name: new RegExp(name),
    }),
  );
}

function chip() {
  return screen.findByRole("button", { name: CHIP });
}

async function confirmAndGetItems(api: ReturnType<typeof installFetchStub>) {
  api.respondToNextPost({ data: { id: "purchase-com14" } });
  fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
  acceptConfirmation();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-com14"));

  return api.posts[0]?.body.items as Array<Record<string, unknown>>;
}

function storedDisassemble() {
  const raw = window.localStorage.getItem(purchaseDraftStorageKey(SESSION));

  return raw ? (JSON.parse(raw) as { lines: { disassemble?: Record<string, boolean> } }).lines.disassemble : null;
}

beforeEach(() => {
  mockPush.mockReset();
  window.localStorage.clear();
  // Sin "Bloquear al agregar": las dos líneas quedan editables.
  window.localStorage.setItem(purchaseLockOnAddStorageKey(SESSION), "0");
});

describe("PurchaseCreatePage · chip «Desarmar al recibir» (COM-14)", () => {
  it("lo ofrece la línea del producto con receta de apertura, sin marcar; la de un producto sin receta, no", async () => {
    renderPage();
    addProduct("Caja de refrescos");
    addProduct("Harina PAN");

    expect(await chip()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Desarmar al recibir Harina PAN" })).not.toBeInTheDocument();
  });

  it("marcado, la línea viaja con disassembleOnReceive: true y las demás sin la clave", async () => {
    const api = renderPage();
    addProduct("Caja de refrescos");
    addProduct("Harina PAN");

    fireEvent.click(await chip());

    expect(await chip()).toHaveAttribute("aria-pressed", "true");

    const items = await confirmAndGetItems(api);

    expect(items.map((item) => [item.productId, item.disassembleOnReceive])).toEqual([
      ["prod-harina", undefined],
      ["prod-caja", true],
    ]);
    expect(items.map((item) => "disassembleOnReceive" in item)).toEqual([false, true]);
  });

  it("sin marcar (o marcado y desmarcado) el payload es el de siempre: ninguna línea lleva la clave", async () => {
    const api = renderPage();
    addProduct("Caja de refrescos");

    fireEvent.click(await chip());
    fireEvent.click(await chip());

    expect(await chip()).toHaveAttribute("aria-pressed", "false");

    const items = await confirmAndGetItems(api);

    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("disassembleOnReceive");
  });

  it("la marca se guarda con el borrador y se va al quitar la línea", async () => {
    renderPage();
    addProduct("Caja de refrescos");
    fireEvent.click(await chip());

    await waitFor(() => expect(Object.values(storedDisassemble() ?? {})).toEqual([true]));

    fireEvent.click(screen.getByRole("button", { name: "Quitar Caja de refrescos" }));

    await waitFor(() => expect(storedDisassemble() ?? {}).toEqual({}));
  });

  it("receta con «Desarmar siempre al recibir compras»: el chip nace MARCADO y la línea viaja marcada sin tocarla", async () => {
    const api = renderPage((url) =>
      url.includes("/api/inventory/pack-conversions")
        ? [{ ...RECIPES[0], alwaysDisassembleOnReceive: true }]
        : null,
    );
    addProduct("Caja de refrescos");
    addProduct("Harina PAN");

    expect(await chip()).toHaveAttribute("aria-pressed", "true");

    const items = await confirmAndGetItems(api);

    expect(items.map((item) => [item.productId, item.disassembleOnReceive])).toEqual([
      ["prod-harina", undefined],
      ["prod-caja", true],
    ]);
  });

  it("el chip que nace marcado por la receta se puede desmarcar: la línea viaja sin la clave y el borrador recuerda la elección", async () => {
    const api = renderPage((url) =>
      url.includes("/api/inventory/pack-conversions")
        ? [{ ...RECIPES[0], alwaysDisassembleOnReceive: true }]
        : null,
    );
    addProduct("Caja de refrescos");

    fireEvent.click(await chip());

    expect(await chip()).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(Object.values(storedDisassemble() ?? {})).toEqual([false]));

    const items = await confirmAndGetItems(api);

    expect(items[0]).not.toHaveProperty("disassembleOnReceive");
  });

  it("una línea bloqueada marcada lo dice como texto y no deja cambiarlo", async () => {
    renderPage();
    addProduct("Caja de refrescos");
    fireEvent.click(await chip());
    fireEvent.click(screen.getByRole("button", { name: "Bloquear Caja de refrescos" }));

    expect(screen.getByText("Se desarma al recibir")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CHIP })).not.toBeInTheDocument();
  });

  it("si las recetas no cargan (o el servidor responde otra cosa) no hay chip y la compra se confirma igual", async () => {
    const api = renderPage(() => null);
    addProduct("Caja de refrescos");

    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([url]) =>
          String(url).includes("/api/inventory/pack-conversions"),
        ),
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: CHIP })).not.toBeInTheDocument();

    const items = await confirmAndGetItems(api);

    expect(items[0]).not.toHaveProperty("disassembleOnReceive");
  });
});
