import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

/**
 * CNF-15 · dos guardias anidados: el del alta rápida de producto (descartar) manda
 * mientras su modal está abierto; al cerrarse sigue activo el de la compra (borrador).
 */

const mockPush = jest.fn();
const mockCan = jest.fn();
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

// Enlace del menú reducido a su <a>: el guardia lo intercepta en el documento.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
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
import Link from "next/link";

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
        {/* Enlace del menú: fuera de la página, lo intercepta el guardia. */}
        <Link href="/sales">Ventas</Link>
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

function guardDialog() {
  return screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });
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

describe("PurchaseCreatePage · guardias anidados: alta de producto dentro de la compra (CNF-15)", () => {
  it("con el alta abierta pregunta por el producto; tras crearlo no pregunta y la compra sigue protegida", async () => {
    const api = installApi();
    const user = renderPage();

    createFromNoResults("Malta 355");

    const form = within(dialog());

    await form.findByRole("option", { name: "Bebidas" });
    await user.click(form.getByLabelText("Costo REF"));
    await user.paste("1,16");

    // Esc con cambios: manda el guardia del formulario, no el de la compra.
    await user.keyboard("{Escape}");

    const productGuard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(productGuard).toHaveTextContent("Producto nuevo «Malta 355» sin guardar");
    expect(productGuard).toHaveTextContent("Si sales ahora, se perderán los cambios.");

    await user.click(within(productGuard).getByRole("button", { name: "Seguir aquí" }));

    expect(guardDialog()).not.toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Nombre")).toHaveValue("Malta 355");
    expect(within(dialog()).getByLabelText("Costo REF")).toHaveValue("1.16");
    expect(within(dialog()).getByLabelText("Costo REF")).toHaveFocus();

    // Se crea: el alta se cierra sola, sin pregunta, y entra como línea de la compra.
    api.respondToNextPost({ data: createdProduct });
    await fillAndSubmit(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(1);
    expect(row("Malta 355")).toBeInTheDocument();

    // El guardia de la compra sigue activo y es el que pregunta al salir de la pantalla.
    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    const purchaseGuard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(purchaseGuard).toHaveTextContent(/Compra/);
    expect(purchaseGuard).toHaveTextContent("1 línea");
    expect(purchaseGuard).not.toHaveTextContent("Producto nuevo");
    expect(purchaseGuard).toHaveTextContent(
      "Si sales ahora, se guardará un borrador para que puedas continuar después.",
    );

    await user.click(within(purchaseGuard).getByRole("button", { name: "Seguir aquí" }));

    expect(guardDialog()).not.toBeInTheDocument();
    expect(row("Malta 355")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("descartar el alta a medias la cierra, no agrega nada y deja la compra protegida", async () => {
    const api = installApi();
    const user = renderPage();

    await user.click(newProductButton() as HTMLElement);
    await user.click(within(dialog()).getByLabelText("Nombre"));
    await user.paste("Harina PAN");
    await user.click(within(dialog()).getByRole("button", { name: "Cancelar" }));

    const productGuard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(productGuard).toHaveTextContent("Producto nuevo «Harina PAN» sin guardar");

    await user.click(within(productGuard).getByRole("button", { name: "Salir" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.posts).toHaveLength(0);
    expect(screen.queryByRole("list", { name: "Líneas de la compra" })).not.toBeInTheDocument();
    // Salir del alta no saca de la compra.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      /Compra/,
    );
  });
});
