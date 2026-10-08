import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
const mockSuppliers = {
  data: {
    items: [{ id: "cont-supplier", name: "Proveedor Demo", type: "proveedor" }],
    limit: 100,
    skip: 0,
    total: 1,
  },
  error: null,
};
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

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../../contacts/hooks/useContacts", () => ({
  useContacts: () => mockSuppliers,
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockRate,
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
  // El buscador se reduce a dos botones; las lineas son las reales.
  const StubPicker = ({
    onAddProduct,
    ...tableProps
  }: Pick<PickerProps, "getItemMeta" | "items" | "onRemoveItem" | "onUpdateItem" | "rateVes"> & {
    onAddProduct: (product: Record<string, unknown>) => void;
  }) => (
    <>
      <PurchaseLineItemsTable {...tableProps} />
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
          getItemMeta={props.getItemMeta}
          items={props.items}
          onRemoveItem={props.onRemoveItem}
          onUpdateItem={props.onUpdateItem}
          rateVes={props.rateVes}
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

import { PurchaseCreatePage } from "./page";

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
    await waitFor(() => expect(input).toHaveValue(""));

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
    expect(screen.getByLabelText("Costo unitario REF de Cable HDMI")).toHaveValue(2);
    expect(screen.getByLabelText("Costo por caja REF de Refresco Cola")).toHaveValue(12);
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

    expect(screen.getByLabelText("Costo unitario REF de Cable HDMI")).toHaveValue(2);
    expect(screen.getByLabelText("Costo por caja REF de Refresco Cola")).toHaveValue(12);

    fireEvent.click(screen.getByRole("button", { name: "Bs" }));

    expect(screen.getByLabelText("Costo unitario BS de Cable HDMI")).toHaveValue(1020);
    expect(screen.getByLabelText("Costo por caja BS de Refresco Cola")).toHaveValue(6120);

    const body = await confirmAndGetBody(api);
    const items = body?.items as Array<Record<string, unknown>>;

    expect(items.map((item) => item.costCurrency)).toEqual(["ves", "ves"]);
  });
});
