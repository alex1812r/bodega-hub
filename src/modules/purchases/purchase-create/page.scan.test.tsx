import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

const mockPush = jest.fn();
const mockResolveByCode = jest.fn();

function mockBuildProduct(name: string, productId: string): PurchaseCatalogProduct {
  return {
    costWithTaxRef: 2,
    currentStock: 5,
    link: "none",
    name,
    packUnits: [],
    productId,
    sku: productId.toUpperCase(),
    taxRate: 0,
    unitCostRef: 2,
  };
}

const CODE_A = "7501234567890";
const CODE_B = "7598765432101";
const CODE_C = "7700000000017";
const mockProductsByCode: Record<string, PurchaseCatalogProduct> = {
  [CODE_A]: mockBuildProduct("Taladro", "prod-a"),
  [CODE_B]: mockBuildProduct("Cable", "prod-b"),
  [CODE_C]: mockBuildProduct("Lija", "prod-c"),
};
const mockCatalog = [mockProductsByCode[CODE_A]];
const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    {
      code: "exento",
      id: "tax-exento",
      isActive: true,
      isDefault: true,
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
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, error: null }),
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
jest.mock("./services/resolveSupplierCatalogProduct", () => ({
  resolvePurchaseProductByCode: (...args: unknown[]) => mockResolveByCode(...args),
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

const LOCK_ON_ADD_KEY = purchaseLockOnAddStorageKey({ storeId: "store-1", userId: "user-1" });
const NOT_FOUND_MESSAGE = "No hay un producto activo con ese código de barras o SKU.";

function renderPage() {
  const QueryWrapper = createQueryWrapper();

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
  return screen.getByRole<HTMLInputElement>("searchbox", { name: "Buscar productos" });
}

function lineNames() {
  const list = screen.queryByRole("list", { name: "Líneas de la compra" });

  return list
    ? within(list)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("p")?.textContent)
    : [];
}

function quantity(name: string) {
  return screen.getByLabelText<HTMLInputElement>(`Cantidad de ${name}`);
}

/** Agrega el Taladro eligiéndolo en la lista del buscador: el foco queda en su Cantidad. */
function pickTaladro() {
  fireEvent.change(searchBox(), { target: { value: "tal" } });
  fireEvent.click(
    within(screen.getByRole("list", { name: "Productos encontrados" })).getByRole("button", {
      name: /Taladro/,
    }),
  );
}

/** El resolvedor contesta cada consulta tras `latencyMs`; solo existen A, B y C. */
function resolveWithLatency(latencyMs: number) {
  mockResolveByCode.mockImplementation(
    (_supplierId: string, code: string) =>
      new Promise((resolve) => {
        setTimeout(() => {
          const product = mockProductsByCode[code];

          resolve(product ? { product, status: "found" } : { status: "not_found" });
        }, latencyMs);
      }),
  );
}

function triedCodes() {
  return mockResolveByCode.mock.calls.map(([, code]) => code as string);
}

/** Teclea carácter a carácter dejando pasar `gapMs` antes de cada tecla. */
async function press(keys: string[], gapMs: number) {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime, delay: null });

  for (const key of keys) {
    act(() => {
      jest.advanceTimersByTime(gapMs);
    });
    await user.keyboard(key);
  }
}

/** El lector: 4 ms por tecla y Enter al final, sobre lo que tenga el foco. */
function scan(code: string) {
  return press([...code.split(""), "{Enter}"], 4);
}

/** Deja pasar el tiempo y las respuestas pendientes del resolvedor. */
async function settle(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockResolveByCode.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem(LOCK_ON_ADD_KEY, "0");
  installFetchStub(() => null);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("PurchaseCreatePage · cantidad de varios dígitos y escaneo en la misma celda (COM-F8 · R1)", () => {
  it.each(["100", "144", "750", "1000"])(
    "Cantidad «%s» tecleada a mano y, sin salir, un EAN-13: queda esa cantidad y entra el producto",
    async (typed) => {
      resolveWithLatency(20);
      renderPage();
      pickTaladro();
      expect(quantity("Taladro")).toHaveFocus();

      await press(typed.split(""), 140);
      await settle(500);
      await scan(CODE_B);
      await settle(1000);

      expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
      expect(lineNames()).toEqual(["Cable", "Taladro"]);
      expect(quantity("Taladro")).toHaveValue(typed);
      expect(triedCodes()).toContain(CODE_B);
    },
  );

  it("Empaques «120» y un EAN-13: quedan 120 empaques y entra el producto", async () => {
    resolveWithLatency(20);
    renderPage();
    pickTaladro();
    fireEvent.click(screen.getByRole("button", { name: "Empaque de Taladro" }));
    const packs = screen.getByLabelText<HTMLInputElement>(/^Cantidad de .+ de Taladro$/);

    act(() => packs.focus());
    await press("120".split(""), 140);
    await settle(500);
    await scan(CODE_B);
    await settle(1000);

    expect(lineNames()).toEqual(["Cable", "Taladro"]);
    expect(screen.getByLabelText(/^Cantidad de .+ de Taladro$/)).toHaveValue("120");
  });
});

describe("PurchaseCreatePage · el foco tras un escaneo se queda en el buscador (COM-F8 · D36)", () => {
  it("escaneo en el buscador: la línea nace con cantidad 1 y desbloqueada, y el foco sigue en el buscador", async () => {
    resolveWithLatency(20);
    renderPage();
    act(() => searchBox().focus());

    await scan(CODE_A);
    await settle(200);

    expect(lineNames()).toEqual(["Taladro"]);
    expect(quantity("Taladro")).toHaveValue("1");
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");

    await scan(CODE_B);
    await settle(200);

    expect(lineNames()).toEqual(["Cable", "Taladro"]);
    expect(searchBox()).toHaveFocus();
  });

  it("un código detectado en una celda: el foco pasa al buscador en el mismo Enter y ahí se queda", async () => {
    resolveWithLatency(300);
    renderPage();
    pickTaladro();
    expect(quantity("Taladro")).toHaveFocus();

    await scan(CODE_B);

    // Aún sin respuesta: el siguiente escaneo ya cae en el buscador.
    expect(lineNames()).toEqual(["Taladro"]);
    expect(searchBox()).toHaveFocus();

    await settle(1000);

    expect(lineNames()).toEqual(["Cable", "Taladro"]);
    expect(quantity("Taladro")).toHaveValue("1");
    expect(quantity("Cable")).toHaveValue("1");
    expect(searchBox()).toHaveFocus();
  });

  it("escanear otra vez el mismo código suma 1 a su línea, la deja desbloqueada y editada, y el foco no sale del buscador", async () => {
    window.localStorage.setItem(LOCK_ON_ADD_KEY, "1");
    resolveWithLatency(20);
    renderPage();
    act(() => searchBox().focus());

    await scan(CODE_A);
    await settle(200);
    await scan(CODE_B);
    await settle(200);
    await scan(CODE_A);
    await settle(200);

    expect(lineNames()).toEqual(["Taladro", "Cable"]);
    expect(quantity("Taladro")).toHaveValue("2");
    expect(screen.getByRole("group", { name: "Líneas editadas" })).toHaveTextContent(
      "Taladro · Cantidad 1 → 2",
    );
    expect(screen.getByRole("button", { name: "Desbloquear Cable" })).toBeInTheDocument();
    expect(searchBox()).toHaveFocus();
  });

  it("elegir el producto en la lista de resultados sí lleva el foco a su Cantidad", () => {
    renderPage();

    pickTaladro();

    expect(quantity("Taladro")).toHaveFocus();
  });
});
