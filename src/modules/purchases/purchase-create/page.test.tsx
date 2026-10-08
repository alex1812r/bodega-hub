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
  const StubPicker = ({
    onAddProduct,
  }: {
    onAddProduct: (product: Record<string, unknown>) => void;
  }) => (
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
  );

  return {
    PurchaseProductPickerCard: (
      props: Parameters<typeof actual.PurchaseProductPickerCard>[0],
    ) =>
      mockUseRealPicker ? (
        <actual.PurchaseProductPickerCard {...props} />
      ) : (
        <StubPicker
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
