import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

/**
 * COM-F13 · Por debajo de `sm` los avisos del buscador ocupan sitio bajo el campo. Si se
 * desmontaran al pulsar fuera, lo de debajo subiría entre el `pointerdown` y el `click` y la
 * pulsación se perdería: en móvil solo desaparecen cuando cambia lo que avisan.
 */

const mockPush = jest.fn();
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
const NO_RESULTS = "No hay productos activos que coincidan";
const SEARCH_ERROR = "No se pudo cargar el catálogo.";
// Lo que devuelve el buscador en cada test.
const mockSearch: {
  catalog: PurchaseCatalogProduct[];
  error: Error | null;
  isSearching: boolean;
} = { catalog: [], error: null, isSearching: false };

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
    mockBuildTaxRate("general", "General", 16, 30),
  ],
  refetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, error: null }),
}));
jest.mock("../../settings/hooks/useSettings", () => ({
  settingsQueryKeys: { paymentMethods: () => ["settings", "payment-methods"] },
  usePricingSettings: () => ({ data: undefined }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
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
    error: mockSearch.error,
    isSearching: mockSearch.isSearching,
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

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  installFetchStub((url) =>
    url.startsWith("/api/categories") ? { items: [], limit: 100, skip: 0, total: 0 } : null,
  );
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

function type(text: string) {
  fireEvent.change(searchBox(), { target: { value: text } });
}

/** Lo que hace el navegador al empezar a pulsar otro control: `mousedown` y el campo pierde el foco. */
function pressDown(target: HTMLElement) {
  fireEvent.pointerDown(target);
  fireEvent.mouseDown(target);
  fireEvent.blur(searchBox());
}

function noResultsNotice() {
  return screen.queryByText(NO_RESULTS)?.parentElement ?? null;
}

beforeEach(() => {
  mockPush.mockReset();
  mockSearch.catalog = [];
  mockSearch.error = null;
  mockSearch.isSearching = false;
  window.localStorage.clear();
});

describe("PurchaseCreatePage · avisos del buscador en móvil (COM-F13)", () => {
  it("con «sin resultados» visible, empezar a pulsar «Nuevo producto» no desmonta el aviso y el clic abre el alta a la primera", () => {
    renderPage();
    type("zzzqq");

    expect(noResultsNotice()).not.toHaveClass("sm:hidden");

    const newProduct = screen.getByRole("button", { name: "Nuevo producto" });

    pressDown(newProduct);

    // Sigue ocupando su sitio en móvil; desde `sm` (donde flota) se cierra como antes.
    expect(noResultsNotice()).toBeInTheDocument();
    expect(noResultsNotice()).toHaveClass("sm:hidden");
    expect(noResultsNotice()).not.toHaveClass("hidden");

    fireEvent.mouseUp(newProduct);
    fireEvent.click(newProduct);

    expect(screen.getByRole("dialog", { name: "Nuevo producto" })).toBeInTheDocument();
    // Abrir el alta sí lo quita.
    expect(noResultsNotice()).not.toBeInTheDocument();
  });

  it("tampoco lo desmonta empezar a pulsar otro control de debajo, ni lo anuncia dos veces", () => {
    renderPage();
    type("zzzqq");
    pressDown(screen.getByRole("heading", { name: "Resumen de Compra" }));

    expect(screen.getAllByText(NO_RESULTS)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Crear producto nuevo" })).toBeInTheDocument();
  });

  it("el aviso desaparece al vaciar el texto y al llegar resultados", () => {
    renderPage();
    type("zzzqq");
    pressDown(screen.getByRole("button", { name: "Nuevo producto" }));
    expect(noResultsNotice()).toBeInTheDocument();

    type("");
    expect(noResultsNotice()).not.toBeInTheDocument();

    type("zzzqq");
    expect(noResultsNotice()).toBeInTheDocument();

    mockSearch.catalog = [mockCableHdmi];
    type("Cable");
    expect(noResultsNotice()).not.toBeInTheDocument();
    // La lista flota en todos los anchos: pulsar fuera la cierra.
    pressDown(screen.getByRole("button", { name: "Nuevo producto" }));
    expect(screen.queryByRole("list", { name: "Productos encontrados" })).not.toBeInTheDocument();
  });

  it("«Buscando...» y el error de búsqueda tampoco se desmontan al pulsar fuera", () => {
    mockSearch.isSearching = true;
    renderPage();
    type("zzzqq");
    pressDown(screen.getByRole("button", { name: "Nuevo producto" }));

    const searching = screen.getByText("Buscando...");

    expect(searching).toHaveClass("sm:hidden");
    expect(searching).not.toHaveClass("hidden");

    mockSearch.isSearching = false;
    mockSearch.error = new Error(SEARCH_ERROR);
    type("zzzqq2");
    pressDown(screen.getByRole("button", { name: "Nuevo producto" }));

    expect(screen.queryByText("Buscando...")).not.toBeInTheDocument();
    expect(screen.getByText(SEARCH_ERROR)).toHaveAttribute("role", "alert");
    expect(screen.getByText(SEARCH_ERROR)).toHaveClass("sm:hidden");
  });

  it("en móvil los tres avisos reservan la misma altura: alternar entre ellos no mueve lo de debajo", () => {
    mockSearch.isSearching = true;
    renderPage();
    type("zzzqq");

    const reserved = ["min-h-[6.625rem]", "sm:min-h-0"];

    expect(screen.getByText("Buscando...")).toHaveClass(...reserved);

    mockSearch.isSearching = false;
    type("zzzqq2");
    expect(noResultsNotice()).toHaveClass(...reserved);

    mockSearch.error = new Error(SEARCH_ERROR);
    type("zzzqq3");
    expect(screen.getByText(SEARCH_ERROR)).toHaveClass(...reserved);
  });
});
