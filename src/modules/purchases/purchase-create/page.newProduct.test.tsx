import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

/** COM-03 · "Nuevo producto" desde la compra, sin salir de `/purchases/create`. */

const mockPush = jest.fn();
const mockCan = jest.fn();
const mockCableHdmi: PurchaseCatalogProduct = {
  costWithTaxRef: 2,
  currentStock: 5,
  link: "none",
  name: "Cable HDMI",
  packUnits: [],
  productId: "prod-cable",
  sku: "ELE-CAB-001",
  taxRate: 0,
  unitCostRef: 2,
};
// Lo que devuelve el buscador en cada test: vacío = "No hay productos activos que coincidan".
const mockSearch: { catalog: PurchaseCatalogProduct[] } = { catalog: [] };

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

const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    mockBuildTaxRate("exento", "Exento", 0, 10),
    mockBuildTaxRate("reducida", "Reducida", 8, 20),
    mockBuildTaxRate("general", "General", 16, 30),
  ],
  refetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, error: null }),
}));
// Sin configuración de la tienda: el formulario usa los chips y el semáforo por defecto.
jest.mock("../../settings/hooks/useSettings", () => ({
  // La clave de la consulta de métodos de pago de "Pagar ahora" (responde el `fetch` de prueba).
  settingsQueryKeys: { paymentMethods: () => ["settings", "payment-methods"] },
  usePricingSettings: () => ({ data: undefined }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockCan(permission),
    isLoading: false,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("./hooks/usePurchaseProductSearch", () => ({
  usePurchaseProductSearch: () => ({
    catalog: mockSearch.catalog,
    error: null,
    isSearching: false,
  }),
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

import { PurchaseCreatePage } from "./page";

const categories = [
  { id: "cat-bebidas", isActive: true, name: "Bebidas", taxRate: 16 },
  { id: "cat-viveres", isActive: true, name: "Víveres", taxRate: 0 },
];
// El alta responde sin la categoría anidada, como `POST /api/products`.
const createdProduct = {
  barcode: null,
  categoryId: "cat-bebidas",
  currentCostRef: 1.16,
  currentStock: 0,
  id: "prod-malta",
  isActive: true,
  minStock: 0,
  name: "Malta 355",
  salePriceRef: 2,
  sku: "malta-355",
};

function installApi() {
  return installFetchStub((url) =>
    url.startsWith("/api/categories")
      ? { items: categories, limit: 100, skip: 0, total: categories.length }
      : null,
  );
}

function renderPage({ withSupplier = true } = {}) {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );

  if (withSupplier) {
    fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  }

  return userEvent.setup({ delay: null });
}

function searchBox() {
  return screen.getByRole("searchbox", { name: "Buscar productos" });
}

function newProductButton() {
  return screen.queryByRole("button", { name: "Nuevo producto" });
}

function dialog() {
  return screen.getByRole("dialog", { name: "Nuevo producto" });
}

function lineRows() {
  return within(screen.getByRole("list", { name: "Líneas de la compra" })).getAllByRole("listitem");
}

function row(name: string) {
  const item = lineRows().find((candidate) => within(candidate).queryByText(name, { selector: "p" }));

  if (!item) {
    throw new Error(`No hay fila de ${name}`);
  }

  return item;
}

function isLocked(name: string) {
  return row(name).getAttribute("data-locked") === "true";
}

/** Busca algo que no existe y pulsa la acción del estado "sin resultados". */
function createFromNoResults(text: string) {
  mockSearch.catalog = [];
  fireEvent.change(searchBox(), { target: { value: text } });
  expect(screen.getByText("No hay productos activos que coincidan")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Crear producto nuevo" }));
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  const form = within(dialog());

  // Las categorías se piden al abrir el alta.
  await form.findByRole("option", { name: "Bebidas" });
  await user.selectOptions(form.getByRole("combobox", { name: /Categoría/ }), "cat-bebidas");
  await user.click(form.getByLabelText("Costo REF"));
  await user.paste("1,16");
  await user.click(form.getByLabelText("Precio REF"));
  await user.paste("2");
  await user.click(form.getByRole("button", { name: "Crear producto" }));
}

beforeEach(() => {
  mockPush.mockReset();
  mockCan.mockReset();
  mockCan.mockReturnValue(true);
  mockSearch.catalog = [];
  window.localStorage.clear();
});

describe("PurchaseCreatePage · Nuevo producto desde la compra (COM-03)", () => {
  it("el botón aparece al elegir proveedor y abre el alta rápida vacía", async () => {
    installApi();
    const user = renderPage({ withSupplier: false });

    expect(newProductButton()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
    await user.click(newProductButton() as HTMLElement);

    const form = within(dialog());

    expect(form.getByLabelText("Nombre")).toHaveValue("");
    expect(form.getByLabelText("Código de barras")).toHaveValue("");
    // Alta rápida: sin "Más opciones" ni proveedores.
    expect(form.queryByText("Más opciones")).not.toBeInTheDocument();
    expect(form.queryByRole("button", { name: "Guardar y crear otro" })).not.toBeInTheDocument();
  });

  it("sin resultados ofrece crear el producto y prellena el nombre con lo buscado", () => {
    installApi();
    renderPage();

    createFromNoResults("  Malta 355 ");

    expect(within(dialog()).getByLabelText("Nombre")).toHaveValue("Malta 355");
    expect(within(dialog()).getByLabelText("Código de barras")).toHaveValue("");
  });

  it("si lo buscado son solo dígitos, prellena el código de barras y no el nombre", () => {
    installApi();
    renderPage();

    createFromNoResults("7591234567890");

    expect(within(dialog()).getByLabelText("Código de barras")).toHaveValue("7591234567890");
    expect(within(dialog()).getByLabelText("Nombre")).toHaveValue("");
  });

  it("con resultados no ofrece la acción de crear en la lista, y sin permiso de productos no hay ningún botón", () => {
    installApi();
    mockCan.mockReturnValue(false);
    renderPage();

    expect(mockCan).toHaveBeenCalledWith("products.manage");
    expect(newProductButton()).not.toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: "Malta" } });
    expect(screen.getByText("No hay productos activos que coincidan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crear producto nuevo" })).not.toBeInTheDocument();
  });

  it("al crearlo se agrega como línea por unidad con el costo sin IVA y la alícuota de la categoría, con foco en Cantidad, y bloquea las anteriores", async () => {
    const api = installApi();
    const user = renderPage();

    mockSearch.catalog = [mockCableHdmi];
    fireEvent.change(searchBox(), { target: { value: "cable" } });
    fireEvent.click(screen.getByRole("button", { name: /Cable HDMI/ }));
    expect(isLocked("Cable HDMI")).toBe(false);

    createFromNoResults("Malta 355");
    api.respondToNextPost({ data: createdProduct });
    await fillAndSubmit(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // El alta viaja tal cual la arma el formulario: con su clave y sin vínculo de proveedor.
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/products");
    expect(api.posts[0]?.body).toMatchObject({
      categoryId: "cat-bebidas",
      currentCostRef: 1.16,
      name: "Malta 355",
      salePriceRef: 2,
    });
    expect(api.posts[0]?.body.clientRequestId).toEqual(expect.any(String));
    expect(JSON.stringify(api.posts[0]?.body)).not.toMatch(/supplier/i);

    // Línea nueva arriba, libre y con el foco en Cantidad; la anterior queda bloqueada.
    expect(lineRows()[0]).toBe(row("Malta 355"));
    expect(isLocked("Malta 355")).toBe(false);
    expect(isLocked("Cable HDMI")).toBe(true);
    await waitFor(() => expect(screen.getByLabelText("Cantidad de Malta 355")).toHaveFocus());
    expect(screen.getByLabelText("Cantidad de Malta 355")).toHaveValue("1");
    expect(within(row("Malta 355")).getByText("malta-355")).toBeInTheDocument();
    // 1,16 REF con IVA del 16 % = 1,00 REF de base = Bs. 510,00; el total vuelve a sumarlo.
    expect(screen.getByLabelText("Costo unitario BS de Malta 355")).toHaveValue("510");
    expect(screen.getByRole("button", { name: /^IVA de Malta 355: / })).toHaveAccessibleName(
      /IVA 16 %$/,
    );
    expect(within(row("Malta 355")).getByText("Bs. 591,60")).toBeInTheDocument();
    // Todo ocurrió en la misma pantalla y el buscador queda limpio para seguir.
    expect(mockPush).not.toHaveBeenCalled();
    expect(searchBox()).toHaveValue("");

    api.respondToNextPost({ data: { id: "purchase-nueva" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));

    const items = api.posts[1]?.body.items as Array<Record<string, unknown>>;

    expect(items[0]).toMatchObject({
      productId: "prod-malta",
      quantity: 1,
      taxRate: 16,
      taxRateCode: "general",
      unitCostRef: 1,
    });
  });

  it("con Bloquear al agregar apagado, crear un producto no bloquea las líneas anteriores", async () => {
    const api = installApi();
    const user = renderPage();

    fireEvent.change(searchBox(), { target: { value: "cable" } });
    mockSearch.catalog = [mockCableHdmi];
    fireEvent.change(searchBox(), { target: { value: "cable h" } });
    fireEvent.click(screen.getByRole("button", { name: /Cable HDMI/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Bloquear al agregar" }));

    createFromNoResults("Malta 355");
    api.respondToNextPost({ data: createdProduct });
    await fillAndSubmit(user);

    await waitFor(() => expect(screen.getByLabelText("Cantidad de Malta 355")).toHaveFocus());
    expect(isLocked("Cable HDMI")).toBe(false);
  });

  it("un 409 del servidor se muestra dentro del modal, que sigue abierto, y no se agrega nada", async () => {
    const api = installApi();
    const user = renderPage();

    createFromNoResults("Malta 355");
    api.respondToNextPost(
      { error: { code: "CONFLICT", message: "Ya existe un producto con ese código de barras." } },
      409,
    );
    await fillAndSubmit(user);

    expect(
      await within(dialog()).findByText("Ya existe un producto con ese código de barras."),
    ).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Nombre")).toHaveValue("Malta 355");
    expect(screen.queryByRole("list", { name: "Líneas de la compra" })).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // Al cerrar y reabrir, el error del intento anterior ya no está.
    await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(newProductButton() as HTMLElement);

    expect(
      within(dialog()).queryByText("Ya existe un producto con ese código de barras."),
    ).not.toBeInTheDocument();
  });

  it("al cerrar el alta con Esc el foco vuelve al botón «Nuevo producto» (COM-F3)", async () => {
    installApi();
    const user = renderPage();

    await user.click(newProductButton() as HTMLElement);
    expect(dialog()).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(newProductButton()).toHaveFocus();
  });

  it("abierta desde «Crear producto nuevo», al cancelar el foco vuelve al buscador: ese botón ya no está (COM-F3)", async () => {
    installApi();
    const user = renderPage();

    createFromNoResults("Malta 355");
    await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(searchBox()).toHaveFocus();
  });
});
