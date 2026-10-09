import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

/**
 * COM-F12 · `/purchases/create` entre 320 y 390 px: nada fuerza a la columna un ancho
 * mínimo mayor que el contenedor (medía 393 px en un área de 358) y ningún importe se recorta.
 */

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
const mockRegleta: PurchaseCatalogProduct = {
  ...mockCableHdmi,
  name: "Regleta 6 tomas",
  productId: "prod-regleta",
  sku: "ELE-REG-001",
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

import { PurchaseSummaryCard } from "./components/PurchaseSummaryCard";
import { PurchaseCreatePage } from "./page";

const WRAP_ANYWHERE = "[overflow-wrap:anywhere]";

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  installFetchStub(() => null);
  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
}

function searchBox() {
  return screen.getByRole("searchbox", { name: "Buscar productos" });
}

function addProduct(product: PurchaseCatalogProduct) {
  mockSearch.catalog = [product];
  fireEvent.change(searchBox(), { target: { value: product.name } });
  fireEvent.click(
    within(screen.getByRole("list", { name: "Productos encontrados" })).getByRole("button"),
  );
}

function lineRow(name: string) {
  const row = within(screen.getByRole("list", { name: "Líneas de la compra" }))
    .getAllByRole("listitem")
    .find((candidate) => within(candidate).queryByText(name, { selector: "p" }));

  if (!row) {
    throw new Error(`No hay fila de ${name}`);
  }

  return row;
}

/** Los dos importes (moneda de la compra y equivalente) de la celda Total de una fila. */
function totalAmounts(row: HTMLElement) {
  const cell = within(row).getByText("Total").parentElement;

  if (!cell) {
    throw new Error("La fila no tiene celda Total");
  }

  return { amounts: Array.from(cell.querySelectorAll("p")), cell };
}

beforeEach(() => {
  mockPush.mockReset();
  mockCan.mockReset();
  mockCan.mockReturnValue(true);
  mockSearch.catalog = [];
  window.localStorage.clear();
});

describe("PurchaseCreatePage · sin desborde entre 320 y 390 px (COM-F12)", () => {
  it("las dos columnas de la página pueden encoger por debajo del ancho mínimo de su contenido", () => {
    renderPage();

    const mainColumn = screen.getByRole("button", { name: "elegir proveedor" }).parentElement;
    const grid = mainColumn?.parentElement;

    expect(grid).toHaveClass("grid", "lg:grid-cols-12");
    expect(grid?.children).toHaveLength(2);
    expect(mainColumn).toHaveClass("min-w-0", "lg:col-span-8");
    expect(grid?.children[1]).toHaveClass("min-w-0", "lg:col-span-4");
    expect(searchBox().closest("section")).toHaveClass("min-w-0");
    expect(
      screen.getByRole("heading", { name: "Resumen de Compra" }).closest("section"),
    ).toHaveClass("min-w-0");
  });

  it("en móvil el buscador ocupa su fila y «Nuevo producto» va en la siguiente", () => {
    renderPage();

    const searchField = searchBox().closest('[role="presentation"]');
    const newProduct = screen.getByRole("button", { name: "Nuevo producto" });

    expect(searchField).toHaveClass("min-w-0", "flex-1");
    expect(searchField?.parentElement).toHaveClass("flex", "min-w-0", "flex-col", "sm:flex-row");
    expect(searchField?.nextElementSibling).toBe(newProduct);
  });

  it("en móvil el aviso sin resultados ocupa sitio bajo el campo en vez de flotar sobre «Nuevo producto»", () => {
    renderPage();

    fireEvent.change(searchBox(), { target: { value: "zz no existe 123" } });

    const notice = screen.getByText("No hay productos activos que coincidan").parentElement;

    expect(notice).toHaveClass("sm:absolute", "sm:top-full");
    expect(notice).not.toHaveClass("absolute");
    expect(screen.getByRole("button", { name: "Crear producto nuevo" })).toBeInTheDocument();

    // La lista de resultados sí flota: no empuja la tabla mientras se escribe.
    mockSearch.catalog = [mockCableHdmi];
    fireEvent.change(searchBox(), { target: { value: "Cable" } });
    expect(screen.getByRole("list", { name: "Productos encontrados" })).toHaveClass(
      "absolute",
      "top-full",
    );
  });

  it("la cabecera de bloqueo envuelve sus botones", () => {
    renderPage();
    addProduct(mockCableHdmi);

    const header = screen.getByRole("group", { name: "Bloqueo de líneas" });
    const lockAll = screen.getByRole("button", { name: "Bloquear todas" });

    expect(header).toHaveClass("flex", "flex-wrap");
    expect(lockAll.parentElement).toHaveClass("flex", "flex-wrap", "justify-end");
    expect(lockAll.parentElement).toContainElement(
      screen.getByRole("button", { name: "Desbloquear todas" }),
    );
  });

  it("apiladas, la fila editable y la bloqueada parten sus importes en vez de recortarlos", () => {
    renderPage();
    addProduct(mockCableHdmi);
    // Al agregar la segunda, la primera se bloquea sola.
    addProduct(mockRegleta);

    const locked = lineRow("Cable HDMI");
    const editable = lineRow("Regleta 6 tomas");

    expect(locked).toHaveAttribute("data-locked", "true");
    expect(editable).not.toHaveAttribute("data-locked");

    for (const row of [locked, editable]) {
      const { amounts, cell } = totalAmounts(row);

      expect(cell).toHaveClass("min-w-0");
      expect(amounts).toHaveLength(2);

      for (const amount of amounts) {
        expect(amount).toHaveClass("tabular-nums", "break-words", "@xl:truncate");
        expect(amount).not.toHaveClass("truncate");
      }
    }
  });
});

describe("PurchaseSummaryCard · importes largos (COM-F12)", () => {
  it("un importe que no cabe junto a su etiqueta se parte, no se sale de la tarjeta", () => {
    render(
      <PurchaseSummaryCard
        costCurrency="ves"
        discountRef={0}
        discountVes={0}
        onConfirm={() => undefined}
        onCostCurrencyChange={() => undefined}
        onDiscountChange={() => undefined}
        subtotalRef={54407498.61}
        subtotalVes={47642426407.68}
        taxBreakdown={[]}
        taxRef={0}
        taxVes={0}
      />,
    );

    const amounts = screen.getAllByText("Bs. 47.642.426.407,68");

    // Subtotal y Total.
    expect(amounts).toHaveLength(2);

    for (const amount of amounts) {
      expect(amount).toHaveClass("tabular-nums", WRAP_ANYWHERE);
      expect(amount.parentElement).toHaveClass("min-w-0", "text-right");
      expect(amount.parentElement?.previousElementSibling).toHaveClass("shrink-0");
    }

    const discount = screen.getByText("- Bs. 0,00");

    expect(discount).toHaveClass("tabular-nums", WRAP_ANYWHERE);
    expect(discount.parentElement).toHaveClass("min-w-0", "text-right");
  });
});
