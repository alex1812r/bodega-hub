import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = jest.fn();
const mockRate = { data: { rateVes: 510 }, error: null };
const mockSupplierProducts: {
  data: { items: unknown[]; limit: number; skip: number; total: number } | undefined;
  error: Error | null;
  isFetching: boolean;
} = { data: undefined, error: null, isFetching: false };
const mockCajaPack = {
  id: "pack-caja",
  isActive: true,
  isDefault: true,
  label: "Caja",
  supplierProductId: "supp-refresco",
  unitsPerPack: 12,
};
// Los tests de envio reducen el buscador a un boton; los del buscador (COM-01) usan el real.
let mockUseRealPicker = false;

function mockBuildTaxRate(code: string, label: string, pct: number, sortOrder: number) {
  return {
    code,
    id: `tax-${code}`,
    isActive: true,
    isDefault: code === "general",
    isGlobal: true,
    label,
    pct,
    sortOrder,
  };
}

const mockDefaultTaxRates = [
  mockBuildTaxRate("exento", "Exento", 0, 10),
  mockBuildTaxRate("reducida", "Reducida", 8, 20),
  mockBuildTaxRate("general", "General", 16, 30),
];
// Catalogo de alicuotas ya cargado: las lineas resuelven su alicuota en el mismo render.
const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: mockDefaultTaxRates,
  refetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockRate,
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../contacts/hooks/useSupplierProducts", () => ({
  useSupplierProducts: () => mockSupplierProducts,
}));
// Proveedor y buscador de productos reducidos a un boton: el test es del envio.
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: ({ onSupplierChange }: { onSupplierChange: (id: string) => void }) => (
    <button onClick={() => onSupplierChange("cont-supplier")} type="button">
      elegir proveedor
    </button>
  ),
}));
jest.mock("./components/PurchaseProductPickerCard", () => {
  const actual = jest.requireActual<typeof import("./components/PurchaseProductPickerCard")>(
    "./components/PurchaseProductPickerCard",
  );
  const { PurchaseLineItemsTable } = jest.requireActual<
    typeof import("./components/PurchaseLineItemsTable")
  >("./components/PurchaseLineItemsTable");
  type PickerProps = Parameters<typeof actual.PurchaseProductPickerCard>[0];
  // El buscador se reduce a tres botones; las lineas y el interruptor "Compra exenta" son los reales.
  const StubPicker = ({
    exemptDisabled,
    exemptPurchase,
    onAddProduct,
    onExemptPurchaseChange,
    ...tableProps
  }: Pick<
    PickerProps,
    | "exemptDisabled"
    | "exemptPurchase"
    | "focusRequest"
    | "getItemMeta"
    | "lines"
    | "lockControls"
    | "onExemptPurchaseChange"
    | "onLineTaxChange"
    | "onRemoveItem"
    | "onSettleItem"
    | "onUpdateItem"
    | "rateVes"
    | "taxCatalog"
  > & {
    onAddProduct: (product: Record<string, unknown>) => void;
  }) => (
    <>
      <actual.PurchaseExemptToggle
        checked={exemptPurchase}
        disabled={exemptDisabled}
        onChange={onExemptPurchaseChange}
      />
      <PurchaseLineItemsTable {...tableProps} />
      <button
        onClick={() =>
          onAddProduct({
            costWithTaxRef: 1.08,
            name: "Harina PAN",
            packUnits: [],
            productId: "prod-harina",
            sku: "HAR-PAN",
            taxRate: 8,
            unitCostRef: 1,
          })
        }
        type="button"
      >
        agregar producto reducido
      </button>
      <button
        onClick={() =>
          onAddProduct({
            name: "Cable HDMI",
            packUnits: [],
            productId: "prod-cable",
            sku: "ELE-CAB-001",
            taxRate: 0,
            unitCostRef: 2,
          })
        }
        type="button"
      >
        agregar producto
      </button>
      <button
        onClick={() =>
          onAddProduct({
            costWithTaxRef: 1.16,
            defaultPackUnit: mockCajaPack,
            name: "Refresco Cola",
            packUnits: [mockCajaPack],
            productId: "prod-refresco",
            sku: "BEB-REF-001",
            taxRate: 16,
            unitCostRef: 1,
          })
        }
        type="button"
      >
        agregar producto con empaque
      </button>
    </>
  );

  return {
    PurchaseProductPickerCard: (props: PickerProps) =>
      mockUseRealPicker ? (
        <actual.PurchaseProductPickerCard {...props} />
      ) : (
        <StubPicker
          exemptDisabled={props.exemptDisabled}
          exemptPurchase={props.exemptPurchase}
          focusRequest={props.focusRequest}
          getItemMeta={props.getItemMeta}
          lines={props.lines}
          lockControls={props.lockControls}
          onExemptPurchaseChange={props.onExemptPurchaseChange}
          onLineTaxChange={props.onLineTaxChange}
          onRemoveItem={props.onRemoveItem}
          onSettleItem={props.onSettleItem}
          onUpdateItem={props.onUpdateItem}
          rateVes={props.rateVes}
          taxCatalog={props.taxCatalog}
          onAddProduct={(product) =>
            props.onAddProduct(product as Parameters<typeof props.onAddProduct>[0])
          }
        />
      ),
  };
});

import {
  createQueryWrapper,
  installFetchStub,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";

import { purchaseLockOnAddStorageKey } from "./hooks/usePurchaseLockOnAdd";
import { PurchaseCreatePage } from "./page";

// Estos tests son anteriores al bloqueo de líneas (COM-12, en `page.lines.test.tsx`):
// con "Bloquear al agregar" apagado, agregar una línea no bloquea las anteriores.
beforeEach(() => {
  window.localStorage.setItem(
    purchaseLockOnAddStorageKey({ storeId: "store-1", userId: "user-1" }),
    "0",
  );
});

function renderWithCart() {
  render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
}

describe("PurchaseCreatePage · idempotencia (C6)", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("doble clic en Confirmar = un solo POST, con clave, y navega con la compra del servidor", async () => {
    const api = installFetchStub(() => null);
    const release = api.holdNextPost({ data: { id: "purchase-del-servidor" } });

    renderWithCart();

    const confirm = screen.getByRole("button", { name: /Confirmar Compra/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByRole("button", { name: /Confirmando/ })).toBeDisabled());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/purchases");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      supplierId: "cont-supplier",
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-del-servidor"));
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la misma clave", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "purchase-1" } });

    renderWithCart();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await screen.findByText("Failed to fetch");
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
    expect(api.posts[1]?.body.items).toEqual(api.posts[0]?.body.items);
  });

  // COM-F8 · 7a: la navegación al detalle no desmonta la página al instante (aquí, nunca).
  it("tras confirmar con éxito, más clics, Enter y Espacio sobre el botón no crean otra compra", async () => {
    const user = userEvent.setup();
    const api = installFetchStub(() => null);
    api.respondToNextPost({ data: { id: "purchase-1" } });
    api.respondToNextPost({ data: { id: "purchase-2" } });
    api.respondToNextPost({ data: { id: "purchase-3" } });

    renderWithCart();

    const confirm = screen.getByRole("button", { name: /Confirmar Compra/ });
    await user.dblClick(confirm);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    await user.click(confirm);
    confirm.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    fireEvent.click(confirm);
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.posts).toHaveLength(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent("Compra registrada");
  });

  it("mientras la compra está en vuelo el botón queda deshabilitado y ocupado", async () => {
    const api = installFetchStub(() => null);
    const release = api.holdNextPost({ data: { id: "purchase-1" } });

    renderWithCart();

    const confirm = screen.getByRole("button", { name: /Confirmar Compra/ });
    expect(confirm).not.toHaveAttribute("aria-busy", "true");
    fireEvent.click(confirm);

    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      release();
    });
    await waitFor(() => expect(confirm).toHaveTextContent("Compra registrada"));
    expect(confirm).not.toHaveAttribute("aria-busy", "true");
  });

  it("si el contenido cambia tras un error de red, el reintento viaja con una clave nueva", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "purchase-1" } });

    renderWithCart();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await screen.findByText("Failed to fetch");

    fireEvent.click(screen.getByRole("button", { name: "agregar producto con empaque" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.items).not.toEqual(api.posts[0]?.body.items);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});

function page<T>(items: T[]) {
  return { items, limit: 20, skip: 0, total: items.length };
}

const category16 = { id: "cat-viveres", isActive: true, name: "Víveres", taxRate: 16 };

function storeProduct(id: string, input: Record<string, unknown> = {}) {
  return {
    barcode: null,
    category: category16,
    categoryId: "cat-viveres",
    currentCostRef: 1.16,
    currentStock: 7,
    id,
    isActive: true,
    minStock: 0,
    name: id,
    salePriceRef: 2,
    sku: id.toUpperCase(),
    ...input,
  };
}

function supplierLink(
  product: ReturnType<typeof storeProduct>,
  input: Record<string, unknown> = {},
) {
  return {
    id: `supp-${product.id}`,
    isActive: true,
    isPreferred: false,
    lastCostRef: 2,
    packUnits: [],
    product: { ...product, taxRate: 16 },
    productId: product.id,
    supplierId: "cont-supplier",
    ...input,
  };
}

const harinaPan = storeProduct("prod-pan", { name: "Harina PAN", sku: "HAR-PAN" });
const harinaJuana = storeProduct("prod-juana", { name: "Harina Juana", sku: "HAR-JUA" });
const harinaSuelta = storeProduct("prod-suelta", {
  barcode: "7591234567890",
  name: "Harina Suelta",
  sku: "HAR-SUE",
});
const harinaVieja = storeProduct("prod-vieja", { isActive: false, name: "Harina Vieja" });

function renderWithRealPicker() {
  render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));

  return screen.getByRole("searchbox", { name: "Buscar productos" });
}

describe("PurchaseCreatePage · buscador sobre todos los productos activos (COM-01)", () => {
  beforeEach(() => {
    mockUseRealPicker = true;
    mockPush.mockReset();
    mockSupplierProducts.data = page([]);
  });

  afterEach(() => {
    mockUseRealPicker = false;
    mockSupplierProducts.data = undefined;
  });

  it("busca en servidor entre los activos y pone primero los vinculados, con chip Habitual / Vinculado", async () => {
    const urls: string[] = [];
    installFetchStub((url) => {
      urls.push(url);
      return page([harinaSuelta, harinaJuana, harinaPan, harinaVieja]);
    });
    mockSupplierProducts.data = page([
      supplierLink(harinaJuana),
      supplierLink(harinaPan, { isPreferred: true, lastCostRef: 1.16 }),
      supplierLink(harinaVieja),
    ]);

    const input = renderWithRealPicker();
    fireEvent.change(input, { target: { value: "harina" } });

    expect(screen.getByText("Buscando...")).toBeInTheDocument();

    const list = await screen.findByRole("list", { name: "Productos encontrados" });
    const options = Array.from(list.querySelectorAll("button")).map((button) => button.textContent);

    expect(options).toEqual([
      "Harina PANHabitual · último costo ref 1.16HAR-PAN · Stock 7",
      "Harina JuanaVinculado · último costo ref 2.00HAR-JUA · Stock 7",
      "Harina SueltaHAR-SUE · Stock 7",
    ]);
    expect(screen.queryByText(/Harina Vieja/)).not.toBeInTheDocument();

    const searchUrl = urls.find((url) => url.startsWith("/api/products?"));
    expect(searchUrl).toContain("search=harina");
    expect(searchUrl).toContain("isActive=true");
    expect(searchUrl).toContain("limit=20");
  });

  it("un no vinculado entra por unidad con el costo actual sin IVA, igual base que el vinculado", async () => {
    const api = installFetchStub(() => page([harinaSuelta, harinaPan]));
    api.respondToNextPost({ data: { id: "purchase-1" } });
    mockSupplierProducts.data = page([
      supplierLink(harinaPan, { isPreferred: true, lastCostRef: 1.16 }),
    ]);

    const input = renderWithRealPicker();
    fireEvent.change(input, { target: { value: "harina" } });
    fireEvent.click(await screen.findByRole("button", { name: /Harina Suelta/ }));
    fireEvent.change(input, { target: { value: "harina" } });
    fireEvent.click(await screen.findByRole("button", { name: /Harina PAN/ }));

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    const items = api.posts[0]?.body.items as Array<Record<string, unknown>>;
    const byProduct = new Map(items.map((item) => [item.productId, item]));

    // Costo con IVA 1.16 al 16 % => 1.00 sin IVA en ambos: el IVA se suma una sola vez.
    expect(byProduct.get("prod-suelta")).toMatchObject({ quantity: 1, taxRate: 16, unitCostRef: 1 });
    expect(byProduct.get("prod-pan")).toMatchObject({ quantity: 1, taxRate: 16, unitCostRef: 1 });
    expect(api.posts[0]?.body).toMatchObject({ subtotalRef: 2, taxRef: 0.32 });
  });

  it("Enter del lector con código de barras exacto agrega la línea aunque no esté vinculado", async () => {
    const urls: string[] = [];
    const api = installFetchStub((url) => {
      urls.push(url);
      if (url.startsWith("/api/products?") && url.includes("barcode=7591234567890")) {
        return page([harinaSuelta]);
      }
      return page([]);
    });
    api.respondToNextPost({ data: { id: "purchase-2" } });

    const input = renderWithRealPicker();
    fireEvent.change(input, { target: { value: "7591234567890" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(input).toHaveValue(""));
    expect(
      urls.some((url) => url.includes("barcode=7591234567890") && url.includes("isActive=true")),
    ).toBe(true);
    expect(urls.some((url) => url.startsWith("/api/suppliers/cont-supplier/products?"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-2"));
    expect(api.posts[0]?.body.items).toEqual([
      expect.objectContaining({ productId: "prod-suelta", quantity: 1, taxRate: 16, unitCostRef: 1 }),
    ]);
  });

  it("Enter con un SKU exacto también agrega; un código que no existe avisa y no agrega", async () => {
    const api = installFetchStub((url) =>
      url.startsWith("/api/products?") && url.includes("sku=HAR-SUE")
        ? page([harinaSuelta])
        : page([]),
    );
    api.respondToNextPost({ data: { id: "purchase-3" } });

    const input = renderWithRealPicker();
    fireEvent.change(input, { target: { value: "0000" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No hay un producto activo con ese código de barras o SKU.",
    );
    expect(input).toHaveValue("0000");

    fireEvent.change(input, { target: { value: "HAR-SUE" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // El buscador se vacía en el mismo Enter (cola de escaneos): la línea llega después.
    expect(input).toHaveValue("");
    expect(await screen.findByLabelText(/^Cantidad de /)).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-3"));
    expect(api.posts[0]?.body.items).toEqual([
      expect.objectContaining({ productId: "prod-suelta", quantity: 1 }),
    ]);
  });

  it("sin coincidencias dice que no hay productos activos", async () => {
    installFetchStub(() => page([]));

    const input = renderWithRealPicker();
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(await screen.findByText("No hay productos activos que coincidan")).toBeInTheDocument();
  });

  it("si la búsqueda falla muestra el mensaje del servidor", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "FORBIDDEN", message: "No tienes permiso para ver productos." } },
          403,
        ),
      ),
    ) as unknown as typeof fetch;

    const input = renderWithRealPicker();
    fireEvent.change(input, { target: { value: "harina" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tienes permiso para ver productos.",
    );
  });
});

// Payload que enviaba la pantalla antes de COM-05 para estas dos líneas (tasa 510, captura en Bs).
const refrescoPackItem = {
  costCurrency: "ves",
  entryMode: "pack",
  packCostRef: 12,
  packCostVes: 6120,
  packCount: 2,
  packLabel: "Caja",
  productId: "prod-refresco",
  subtotalRef: 24,
  subtotalVes: 12240,
  taxRate: 16,
  taxRateCode: "general",
  taxRef: 3.84,
  taxVes: 1958.4,
  unitCostRef: 1,
  unitCostVes: 510,
  unitsPerPack: 12,
};
const cableUnitItem = {
  costCurrency: "ves",
  entryMode: "unit",
  productId: "prod-cable",
  quantity: 3,
  subtotalRef: 6,
  subtotalVes: 3060,
  taxRate: 0,
  taxRateCode: "exento",
  taxRef: 0,
  taxVes: 0,
  unitCostRef: 2,
  unitCostVes: 1020,
};
const twoLinePurchaseTotals = {
  discountRef: 0,
  discountVes: 0,
  refRateVes: 510,
  status: "recibido",
  subtotalRef: 30,
  subtotalVes: 15300,
  supplierId: "cont-supplier",
  taxRef: 3.84,
  taxVes: 1958.4,
};

function renderTwoLinePurchase() {
  render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto con empaque" }));
  fireEvent.change(screen.getByLabelText("Cantidad de Cable HDMI"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Cantidad de caja de Refresco Cola"), {
    target: { value: "2" },
  });
}

async function confirmAndGetBody(api: ReturnType<typeof installFetchStub>) {
  api.respondToNextPost({ data: { id: "purchase-moneda" } });
  fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-moneda"));

  return api.posts[0]?.body;
}

describe("PurchaseCreatePage · moneda de costo una vez por compra (COM-05)", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("sin tocar la moneda, totales y payload son los de antes y cada línea manda costCurrency", async () => {
    const api = installFetchStub(() => null);

    renderTwoLinePurchase();

    expect(screen.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Bs. 17.258,40")).toBeInTheDocument();
    expect(screen.getByText("ref 33.84")).toBeInTheDocument();

    expect(await confirmAndGetBody(api)).toEqual({
      ...twoLinePurchaseTotals,
      clientRequestId: expect.any(String),
      items: [refrescoPackItem, cableUnitItem],
    });
  });

  it("el selector está una sola vez, en el resumen, y ninguna línea trae el suyo", () => {
    installFetchStub(() => null);

    renderTwoLinePurchase();

    expect(screen.getAllByRole("button", { name: "REF" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Bs" })).toHaveLength(1);
    expect(screen.queryByRole("group", { name: /Moneda de costo de/ })).not.toBeInTheDocument();
  });

  it("cambiar a REF pasa TODAS las líneas a REF sin mover totales ni montos del payload", async () => {
    const api = installFetchStub(() => null);

    renderTwoLinePurchase();
    fireEvent.click(screen.getByRole("button", { name: "REF" }));

    expect(screen.getByRole("button", { name: "REF" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Costo unitario REF de Cable HDMI")).toHaveValue("2.00");
    expect(screen.getByLabelText("Costo por caja REF de Refresco Cola")).toHaveValue("12.00");
    expect(screen.queryByLabelText(/Costo .* BS de/)).not.toBeInTheDocument();
    expect(screen.getByText("Bs. 17.258,40")).toBeInTheDocument();
    expect(screen.getByText("ref 33.84")).toBeInTheDocument();

    expect(await confirmAndGetBody(api)).toEqual({
      ...twoLinePurchaseTotals,
      clientRequestId: expect.any(String),
      items: [
        { ...refrescoPackItem, costCurrency: "ref" },
        { ...cableUnitItem, costCurrency: "ref" },
      ],
    });
  });

  it("las líneas nuevas nacen en la moneda de la compra y volver a Bs las devuelve todas", async () => {
    const api = installFetchStub(() => null);

    render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
    fireEvent.click(screen.getByRole("button", { name: "REF" }));
    fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
    fireEvent.click(screen.getByRole("button", { name: "agregar producto con empaque" }));

    expect(screen.getByLabelText("Costo unitario REF de Cable HDMI")).toHaveValue("2.00");
    expect(screen.getByLabelText("Costo por caja REF de Refresco Cola")).toHaveValue("12.00");

    fireEvent.click(screen.getByRole("button", { name: "Bs" }));

    expect(screen.getByLabelText("Costo unitario BS de Cable HDMI")).toHaveValue("1020.00");
    expect(screen.getByLabelText("Costo por caja BS de Refresco Cola")).toHaveValue("6120.00");

    const body = await confirmAndGetBody(api);
    const items = body?.items as Array<Record<string, unknown>>;

    expect(items.map((item) => item.costCurrency)).toEqual(["ves", "ves"]);
  });
});

function renderPurchase(...addButtons: string[]) {
  render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  for (const name of addButtons) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
}

describe("PurchaseCreatePage · línea simple por defecto (COM-04)", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("una línea nueva muestra producto, cantidad, costo y total: dos inputs y ningún selector", () => {
    installFetchStub(() => null);

    renderPurchase("agregar producto");

    const row = screen.getByRole("listitem");
    const inputs = within(row).getAllByRole("textbox");

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAccessibleName("Cantidad de Cable HDMI");
    expect(inputs[1]).toHaveAccessibleName("Costo unitario BS de Cable HDMI");
    expect(row.querySelectorAll("input, select, textarea")).toHaveLength(2);
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row).queryByRole("group")).not.toBeInTheDocument();
    expect(within(row).queryByText("Impuesto")).not.toBeInTheDocument();

    expect(within(row).getByText("Cable HDMI")).toBeInTheDocument();
    expect(within(row).getByText("ELE-CAB-001")).toBeInTheDocument();
    // Total en la moneda de la compra y la otra como secundario.
    expect(within(row).getByText("Bs. 1.020,00")).toBeInTheDocument();
    expect(within(row).getByText("ref 2.00")).toBeInTheDocument();

    expect(within(row).getByRole("button", { name: "Empaque de Cable HDMI" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      within(row).getByRole("button", { name: "IVA de Cable HDMI: Exento" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("el chip Empaque despliega los cuatro campos y el POST en modo empaque es el de antes", async () => {
    const api = installFetchStub(() => null);

    renderPurchase("agregar producto");

    const row = screen.getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Empaque de Cable HDMI" }));

    expect(within(row).getByRole("button", { name: "Empaque de Cable HDMI" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(row.querySelectorAll("input, select")).toHaveLength(4);
    expect(within(row).getByRole("combobox", { name: "Tipo de empaque de Cable HDMI" })).toHaveValue(
      "custom:Bulto",
    );

    fireEvent.change(within(row).getByLabelText("Cantidad de bulto de Cable HDMI"), {
      target: { value: "2" },
    });
    fireEvent.change(within(row).getByLabelText("Unidades por bulto de Cable HDMI"), {
      target: { value: "6" },
    });
    fireEvent.change(within(row).getByLabelText("Costo por bulto BS de Cable HDMI"), {
      target: { value: "6120" },
    });

    // La fila principal pasa a mostrar las unidades totales y el costo unitario derivado.
    expect(within(row).getByText("12 u")).toBeInTheDocument();
    expect(within(row).getByText("Bs. 1.020,00")).toBeInTheDocument();

    // Mismo payload que enviaba el modo "Personalizado" antes de COM-04.
    expect(await confirmAndGetBody(api)).toEqual({
      clientRequestId: expect.any(String),
      discountRef: 0,
      discountVes: 0,
      items: [
        {
          costCurrency: "ves",
          entryMode: "pack",
          packCostRef: 12,
          packCostVes: 6120,
          packCount: 2,
          packLabel: "Bulto",
          productId: "prod-cable",
          subtotalRef: 24,
          subtotalVes: 12240,
          taxRate: 0,
          taxRateCode: "exento",
          taxRef: 0,
          taxVes: 0,
          unitCostRef: 2,
          unitCostVes: 1020,
          unitsPerPack: 6,
        },
      ],
      refRateVes: 510,
      status: "recibido",
      subtotalRef: 24,
      subtotalVes: 12240,
      supplierId: "cont-supplier",
      taxRef: 0,
      taxVes: 0,
    });
  });

  it("un producto con empaque por defecto del proveedor nace en modo empaque, con el chip activo", async () => {
    const api = installFetchStub(() => null);

    renderPurchase("agregar producto con empaque");

    const row = screen.getByRole("listitem");

    expect(within(row).getByRole("button", { name: "Empaque de Refresco Cola" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(row).getByRole("combobox", { name: "Tipo de empaque de Refresco Cola" }),
    ).toHaveValue("pack-caja");
    expect(within(row).getByLabelText("Cantidad de caja de Refresco Cola")).toHaveValue("1");
    expect(within(row).getByLabelText("Costo por caja BS de Refresco Cola")).toHaveValue("6120.00");
    // Las unidades del empaque guardado no se teclean.
    expect(within(row).queryByLabelText(/Unidades por caja/)).not.toBeInTheDocument();
    expect(within(row).getByText("12 u")).toBeInTheDocument();

    const body = await confirmAndGetBody(api);

    expect(body?.items).toEqual([
      { ...refrescoPackItem, packCount: 1, subtotalRef: 12, subtotalVes: 6120, taxRef: 1.92, taxVes: 979.2 },
    ]);
  });

  it("quitar el chip Empaque vuelve a unidad conservando las unidades totales y el monto", async () => {
    const api = installFetchStub(() => null);

    renderPurchase("agregar producto con empaque");

    const row = screen.getByRole("listitem");
    fireEvent.change(within(row).getByLabelText("Cantidad de caja de Refresco Cola"), {
      target: { value: "2" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Empaque de Refresco Cola" }));

    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row).getByLabelText("Cantidad de Refresco Cola")).toHaveValue("24");
    expect(within(row).getByLabelText("Costo unitario BS de Refresco Cola")).toHaveValue("510.00");

    const body = await confirmAndGetBody(api);

    expect(body?.items).toEqual([
      {
        costCurrency: "ves",
        entryMode: "unit",
        productId: "prod-refresco",
        quantity: 24,
        subtotalRef: 24,
        subtotalVes: 12240,
        taxRate: 16,
        taxRateCode: "general",
        taxRef: 3.84,
        taxVes: 1958.4,
        unitCostRef: 1,
        unitCostVes: 510,
      },
    ]);
  });

  it("elegir un tipo personalizado deja teclear las unidades por empaque", () => {
    installFetchStub(() => null);

    renderPurchase("agregar producto con empaque");

    const row = screen.getByRole("listitem");
    fireEvent.change(within(row).getByRole("combobox", { name: "Tipo de empaque de Refresco Cola" }), {
      target: { value: "custom:Manga" },
    });

    expect(within(row).getByLabelText("Unidades por manga de Refresco Cola")).toHaveValue("12");
    expect(within(row).getByLabelText("Costo por manga BS de Refresco Cola")).toHaveValue("6120.00");
  });
});

function renderPurchaseWithToasts(...addButtons: string[]) {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  for (const name of addButtons) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
}

function taxChip(productName: string) {
  return screen.getByRole("button", { name: new RegExp(`^IVA de ${productName}: `) });
}

function chooseTaxRate(productName: string, rateLabel: RegExp) {
  fireEvent.click(taxChip(productName));
  fireEvent.click(screen.getByRole("radio", { name: rateLabel }));
}

function exemptSwitch() {
  return screen.getByRole("switch", { name: "Compra exenta" });
}

function summaryBreakdown() {
  return screen.queryByRole("group", { name: "Desglose de IVA por alícuota" });
}

describe("PurchaseCreatePage · alícuota de IVA por línea (COM-11)", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  afterEach(() => {
    mockTaxCatalog.rates = mockDefaultTaxRates;
  });

  it("una línea nueva nace con la alícuota de la categoría del producto y el POST lleva su taxRateCode", async () => {
    const api = installFetchStub(() => null);

    renderPurchase("agregar producto", "agregar producto reducido", "agregar producto con empaque");

    expect(taxChip("Cable HDMI")).toHaveAccessibleName("IVA de Cable HDMI: Exento");
    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: IVA 8 %");
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: IVA 16 %");
    expect(screen.queryByText("Elige una alícuota")).not.toBeInTheDocument();

    const body = await confirmAndGetBody(api);
    const items = body?.items as Array<Record<string, unknown>>;

    expect(items.map((item) => [item.productId, item.taxRateCode, item.taxRate])).toEqual([
      ["prod-refresco", "general", 16],
      ["prod-harina", "reducida", 8],
      ["prod-cable", "exento", 0],
    ]);
  });

  it("el chip abre las alícuotas del catálogo, marca la de la categoría y elegir una cierra la lista", () => {
    installFetchStub(() => null);

    renderPurchase("agregar producto con empaque");

    const chip = taxChip("Refresco Cola");

    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Exento 0 %",
      "Reducida 8 %",
      "General 16 %por defecto",
    ]);
    expect(screen.getByRole("radio", { name: /General/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Reducida/ }));

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: IVA 8 %");

    // La de la categoría sigue marcada "por defecto" aunque la línea ya use otra.
    fireEvent.click(taxChip("Refresco Cola"));
    expect(screen.getByRole("radio", { name: /General/ })).toHaveTextContent("por defecto");
    expect(screen.getByRole("radio", { name: /Reducida/ })).toBeChecked();
  });

  it("cambiar la alícuota con los chips recalcula el total y el payload", async () => {
    const api = installFetchStub(() => null);

    renderPurchase("agregar producto con empaque");

    // 1 caja a 6.120 Bs (12 REF) al 16 %.
    expect(screen.getAllByText("Bs. 7.099,20")).toHaveLength(2);

    chooseTaxRate("Refresco Cola", /Reducida/);

    // Al 8 %: 489,60 Bs / 0,96 REF de IVA, en la línea y en el total del resumen.
    expect(screen.queryByText("Bs. 7.099,20")).not.toBeInTheDocument();
    expect(screen.getAllByText("Bs. 6.609,60")).toHaveLength(2);
    expect(screen.getAllByText("ref 12.96")).toHaveLength(2);

    expect(await confirmAndGetBody(api)).toEqual({
      ...twoLinePurchaseTotals,
      clientRequestId: expect.any(String),
      items: [
        {
          ...refrescoPackItem,
          packCount: 1,
          subtotalRef: 12,
          subtotalVes: 6120,
          taxRate: 8,
          taxRateCode: "reducida",
          taxRef: 0.96,
          taxVes: 489.6,
        },
      ],
      subtotalRef: 12,
      subtotalVes: 6120,
      taxRef: 0.96,
      taxVes: 489.6,
    });
  });

  it('"Compra exenta" pasa todas las líneas a Exento con un clic, también las que se agreguen después', async () => {
    const api = installFetchStub(() => null);

    renderPurchaseWithToasts("agregar producto con empaque", "agregar producto reducido");

    expect(exemptSwitch()).toHaveAttribute("aria-checked", "false");

    fireEvent.click(exemptSwitch());

    expect(exemptSwitch()).toHaveAttribute("aria-checked", "true");
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: Exento");
    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: Exento");
    // Ninguna línea tenía una alícuota elegida a mano: no hay aviso.
    expect(screen.queryByText(/elegida a mano/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
    fireEvent.click(screen.getByRole("button", { name: "agregar producto reducido" }));

    expect(taxChip("Cable HDMI")).toHaveAccessibleName("IVA de Cable HDMI: Exento");
    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: Exento");

    const body = await confirmAndGetBody(api);
    const items = body?.items as Array<Record<string, unknown>>;

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item).toMatchObject({ taxRate: 0, taxRateCode: "exento", taxRef: 0, taxVes: 0 });
    }
    expect(body).toMatchObject({ taxRef: 0, taxVes: 0 });
  });

  it('una línea agregada con "Compra exenta" activo nace exenta y al desactivarlo cada una vuelve a la de su categoría', () => {
    installFetchStub(() => null);

    renderPurchaseWithToasts("agregar producto con empaque");
    fireEvent.click(exemptSwitch());
    fireEvent.click(screen.getByRole("button", { name: "agregar producto reducido" }));

    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: Exento");
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: Exento");

    fireEvent.click(exemptSwitch());

    expect(exemptSwitch()).toHaveAttribute("aria-checked", "false");
    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: IVA 8 %");
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: IVA 16 %");
  });

  it("avisa de las líneas con alícuota elegida a mano al activar la compra exenta, y las pasa a Exento igualmente", () => {
    installFetchStub(() => null);

    renderPurchaseWithToasts(
      "agregar producto",
      "agregar producto reducido",
      "agregar producto con empaque",
    );
    chooseTaxRate("Refresco Cola", /Reducida/);
    chooseTaxRate("Harina PAN", /General/);
    // Elegida a mano pero ya exenta: no cambia, no se cuenta.
    chooseTaxRate("Cable HDMI", /Reducida/);
    chooseTaxRate("Cable HDMI", /Exento/);

    fireEvent.click(exemptSwitch());

    expect(
      screen.getByText("2 líneas tenían una alícuota elegida a mano; ahora son exentas"),
    ).toBeInTheDocument();
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: Exento");
    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: Exento");

    // Al desactivarlo vuelven a la de su categoría, no a la elegida a mano.
    fireEvent.click(exemptSwitch());

    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: IVA 16 %");
    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: IVA 8 %");
  });

  it("con una sola línea elegida a mano el aviso va en singular", () => {
    installFetchStub(() => null);

    renderPurchaseWithToasts("agregar producto con empaque");
    chooseTaxRate("Refresco Cola", /Reducida/);
    fireEvent.click(exemptSwitch());

    expect(
      screen.getByText("1 línea tenía una alícuota elegida a mano; ahora es exenta"),
    ).toBeInTheDocument();
  });

  it('con "Compra exenta" activo una línea puede cambiar su alícuota y el interruptor sigue activo', async () => {
    const api = installFetchStub(() => null);

    renderPurchaseWithToasts("agregar producto", "agregar producto con empaque");
    fireEvent.click(exemptSwitch());
    chooseTaxRate("Refresco Cola", /General/);

    expect(exemptSwitch()).toHaveAttribute("aria-checked", "true");
    expect(taxChip("Refresco Cola")).toHaveAccessibleName("IVA de Refresco Cola: IVA 16 %");
    expect(taxChip("Cable HDMI")).toHaveAccessibleName("IVA de Cable HDMI: Exento");

    const body = await confirmAndGetBody(api);
    const items = body?.items as Array<Record<string, unknown>>;

    expect(items.map((item) => item.taxRateCode)).toEqual(["general", "exento"]);
  });

  it("el resumen desglosa base e IVA por alícuota y el desglose suma lo mismo que los totales", async () => {
    const api = installFetchStub(() => null);

    renderTwoLinePurchase();

    const breakdown = summaryBreakdown() as HTMLElement;
    const rows = [...breakdown.children];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Base Exento 0 %Bs. 3.060,00ref 6.00");
    expect(rows[0]).toHaveTextContent("IVA Exento 0 %Bs. 0,00ref 0.00");
    expect(rows[1]).toHaveTextContent("Base General 16 %Bs. 12.240,00ref 24.00");
    expect(rows[1]).toHaveTextContent("IVA General 16 %Bs. 1.958,40ref 3.84");
    expect(screen.queryByText(/^Impuestos/)).not.toBeInTheDocument();

    // 3.060 + 12.240 = subtotal; 0 + 1.958,40 = IVA; total = 17.258,40.
    expect(screen.getByText("Bs. 15.300,00")).toBeInTheDocument();
    expect(screen.getByText("Bs. 17.258,40")).toBeInTheDocument();

    const body = await confirmAndGetBody(api);

    expect(body).toMatchObject({
      subtotalRef: 6 + 24,
      subtotalVes: 3060 + 12240,
      taxRef: 3.84,
      taxVes: 1958.4,
    });
  });

  it("sin líneas el resumen no muestra desglose", () => {
    installFetchStub(() => null);

    renderPurchase();

    expect(summaryBreakdown()).not.toBeInTheDocument();
  });

  it("no existe ningún input de IVA: ni en la línea ni con la lista de alícuotas abierta", () => {
    installFetchStub(() => null);

    renderPurchase("agregar producto", "agregar producto con empaque");
    fireEvent.click(taxChip("Refresco Cola"));

    const fields = [...document.querySelectorAll("input, select, textarea, [contenteditable]")];
    const names = fields.map(
      (field) => field.getAttribute("aria-label") ?? field.getAttribute("placeholder") ?? "",
    );

    expect(fields.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/iva|impuesto|al[ií]cuota|%/i);
    }
    expect(
      within(screen.getByRole("dialog", { name: "IVA de Refresco Cola" })).queryByRole("textbox"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Impuesto")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar impuesto/ })).not.toBeInTheDocument();
  });

  it('si ninguna alícuota activa tiene el % de la categoría, la línea pide "Elige una alícuota" y no se confirma', async () => {
    const api = installFetchStub(() => null);

    mockTaxCatalog.rates = mockDefaultTaxRates.map((rate) =>
      rate.code === "reducida" ? { ...rate, isActive: false } : rate,
    );
    renderPurchase("agregar producto reducido");

    const row = screen.getByRole("listitem");

    expect(taxChip("Harina PAN")).toHaveAccessibleName("IVA de Harina PAN: Elegir IVA");
    expect(within(row).getByRole("alert")).toHaveTextContent("Elige una alícuota");

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));

    expect(
      screen.getByText("Elige una alícuota en cada línea antes de confirmar la compra."),
    ).toBeInTheDocument();
    expect(api.posts).toHaveLength(0);

    chooseTaxRate("Harina PAN", /General/);

    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();

    const body = await confirmAndGetBody(api);

    expect(body?.items).toEqual([
      expect.objectContaining({ productId: "prod-harina", taxRate: 16, taxRateCode: "general" }),
    ]);
  });

  it('sin una alícuota activa del 0 % el interruptor "Compra exenta" queda deshabilitado', () => {
    installFetchStub(() => null);

    mockTaxCatalog.rates = mockDefaultTaxRates.filter((rate) => rate.code !== "exento");
    renderPurchase("agregar producto con empaque");

    expect(exemptSwitch()).toBeDisabled();
  });
});
