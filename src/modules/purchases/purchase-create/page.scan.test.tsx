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
    <>
      <button onClick={() => onSupplierChange("cont-supplier")} type="button">
        elegir proveedor
      </button>
      <button onClick={() => onSupplierChange("cont-other")} type="button">
        elegir otro proveedor
      </button>
    </>
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

describe("PurchaseCreatePage · cola de escaneos (COM-F8 · 2f, R2, 2g)", () => {
  /** Escaneos seguidos sobre lo que tenga el foco, con `gapMs` entre el Enter de uno y el siguiente. */
  async function scanChain(codes: string[], gapMs: number) {
    for (const code of codes) {
      await scan(code);
      await settle(gapMs);
    }
  }

  function cellValues() {
    return within(screen.getByRole("list", { name: "Líneas de la compra" }))
      .getAllByRole<HTMLInputElement>("textbox")
      .map((input) => input.value);
  }

  it.each([
    [0, 20],
    [30, 20],
    [120, 20],
    [0, 300],
    [500, 300],
    [500, 800],
    [1000, 800],
    [1500, 800],
  ])(
    "A, B y C escaneados cada %i ms con %i ms de latencia: tres líneas en orden, nada perdido ni mezclado",
    async (gapMs, latencyMs) => {
      resolveWithLatency(latencyMs);
      renderPage();
      act(() => searchBox().focus());

      await scanChain([CODE_A, CODE_B, CODE_C], gapMs);
      await settle(latencyMs * 4 + 500);

      expect(triedCodes()).toEqual([CODE_A, CODE_B, CODE_C]);
      expect(lineNames()).toEqual(["Lija", "Cable", "Taladro"]);
      // Cantidad y costo de cada línea: ni un dígito de un código en ninguna celda.
      expect(cellValues()).toEqual(["1", "1020", "1", "1020", "1", "1020"]);
      expect(searchBox()).toHaveValue("");
      expect(searchBox()).toHaveFocus();
      expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
    },
  );

  it("el buscador se vacía en el mismo Enter y sigue aceptando tecleo mientras hay cola", async () => {
    resolveWithLatency(800);
    renderPage();
    act(() => searchBox().focus());

    await scan(CODE_A);

    expect(searchBox()).toHaveValue("");
    expect(searchBox()).not.toHaveAttribute("readonly");

    await press("cab".split(""), 120);
    await settle(1000);

    expect(lineNames()).toEqual(["Taladro"]);
    // Lo tecleado mientras se resolvía A no se borra al llegar su respuesta.
    expect(searchBox()).toHaveValue("cab");
  });

  it("el mismo código repetido en la cola suma 1 cada vez: A, A, B, A deja A en 3", async () => {
    resolveWithLatency(300);
    renderPage();
    act(() => searchBox().focus());

    await scanChain([CODE_A, CODE_A, CODE_B, CODE_A], 30);
    await settle(2000);

    expect(lineNames()).toEqual(["Taladro", "Cable"]);
    expect(quantity("Taladro")).toHaveValue("3");
    expect(quantity("Cable")).toHaveValue("1");
  });

  it("un código que no existe da su aviso y no frena a los siguientes", async () => {
    resolveWithLatency(300);
    renderPage();
    act(() => searchBox().focus());

    await scanChain([CODE_A, "1111111111116", CODE_C], 30);
    await settle(2000);

    expect(lineNames()).toEqual(["Lija", "Taladro"]);
    expect(triedCodes()).toEqual([CODE_A, "1111111111116", CODE_C]);
    // Con otro código detrás en la cola, el aviso lleva el código que no entró.
    expect(screen.getByText("No se agregó el código 1111111111116")).toBeInTheDocument();
  });

  it("si la consulta de un código falla, avisa y los siguientes entran", async () => {
    resolveWithLatency(300);
    mockResolveByCode.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("red")), 300);
        }),
    );
    renderPage();
    act(() => searchBox().focus());

    await scanChain([CODE_A, CODE_B], 0);
    await settle(1000);

    expect(lineNames()).toEqual(["Cable"]);
    expect(screen.getByText("No se agregó el código 7501234567890")).toBeInTheDocument();
  });

  it("dos escaneos seguidos con el foco en una celda: el primero se detecta en la celda, el segundo cae en el buscador y entran los dos", async () => {
    resolveWithLatency(300);
    renderPage();
    pickTaladro();
    expect(quantity("Taladro")).toHaveFocus();

    await scanChain([CODE_B, CODE_C], 0);
    await settle(3000);

    expect(lineNames()).toEqual(["Lija", "Cable", "Taladro"]);
    expect(cellValues()).toEqual(["1", "1020", "1", "1020", "1", "1020"]);
    expect(searchBox()).toHaveValue("");
  });

  it("dos códigos detectados en la misma celda sin esperar al primero: entran los dos y la celda conserva su valor", async () => {
    resolveWithLatency(300);
    renderPage();
    pickTaladro();

    await scan(CODE_B);
    // El usuario vuelve a la celda antes de que llegue la respuesta y escanea ahí.
    act(() => quantity("Taladro").focus());
    await scan(CODE_C);
    await settle(3000);

    expect(lineNames()).toEqual(["Lija", "Cable", "Taladro"]);
    expect(quantity("Taladro")).toHaveValue("1");
  });

  it("cambiar de proveedor descarta los escaneos que aún no se resolvieron", async () => {
    resolveWithLatency(800);
    renderPage();
    act(() => searchBox().focus());

    await scanChain([CODE_A, CODE_B], 0);
    fireEvent.click(screen.getByRole("button", { name: "elegir otro proveedor" }));
    await settle(4000);

    expect(lineNames()).toEqual([]);
    expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(/No se agregó el código/)).not.toBeInTheDocument();
  });

  it("un código suelto que no existe vuelve al buscador, seleccionado, con la oferta de crearlo; el siguiente escaneo lo sustituye", async () => {
    resolveWithLatency(20);
    renderPage();
    act(() => searchBox().focus());

    await scan("1111111111116");
    expect(searchBox()).toHaveValue("");
    await settle(200);

    expect(screen.getByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(searchBox()).toHaveValue("1111111111116");
    expect(searchBox().selectionStart).toBe(0);
    expect(searchBox().selectionEnd).toBe(13);

    await scan(CODE_A);
    await settle(200);

    expect(triedCodes()).toEqual(["1111111111116", CODE_A]);
    expect(lineNames()).toEqual(["Taladro"]);
    expect(searchBox()).toHaveValue("");
    expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument();
  });
});
