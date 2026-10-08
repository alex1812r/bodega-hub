import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

const mockPush = jest.fn();
const mockResolveByCode = jest.fn();
const mockCajaPack = {
  id: "pack-caja",
  isActive: true,
  isDefault: true,
  label: "Caja",
  supplierProductId: "supp-refresco",
  unitsPerPack: 12,
};
const mockCatalog: PurchaseCatalogProduct[] = [
  {
    costWithTaxRef: 2,
    currentStock: 5,
    link: "none",
    name: "Cable HDMI",
    packUnits: [],
    productId: "prod-cable",
    sku: "ELE-CAB-001",
    taxRate: 0,
    unitCostRef: 2,
  },
  {
    costWithTaxRef: 1.08,
    currentStock: 9,
    link: "none",
    name: "Harina PAN",
    packUnits: [],
    productId: "prod-harina",
    sku: "HAR-PAN",
    taxRate: 8,
    unitCostRef: 1,
  },
  {
    costWithTaxRef: 1.16,
    currentStock: 3,
    defaultPackUnit: mockCajaPack,
    link: "preferred",
    name: "Refresco Cola",
    packUnits: [mockCajaPack],
    productId: "prod-refresco",
    sku: "BEB-REF-001",
    taxRate: 16,
    unitCostRef: 1,
  },
];

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
jest.mock("../../contacts/hooks/useContacts", () => ({
  useContacts: () => ({
    data: {
      items: [{ id: "cont-supplier", name: "Proveedor Demo", type: "proveedor" }],
      limit: 100,
      skip: 0,
      total: 1,
    },
    error: null,
  }),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, error: null }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ profile: { storeId: "store-1", user: { id: "user-1" } } }),
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
// El buscador real con un catálogo fijo: cualquier texto devuelve los tres productos.
jest.mock("./hooks/usePurchaseProductSearch", () => ({
  usePurchaseProductSearch: () => ({ catalog: mockCatalog, error: null, isSearching: false }),
}));
// El lector resuelve el código en servidor: aquí devuelve lo que diga cada test.
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
  return screen.getByRole("searchbox", { name: "Buscar productos" });
}

/** Agrega un producto como lo hace el usuario: escribe en el buscador y elige el resultado. */
function addProduct(name: string) {
  fireEvent.change(searchBox(), { target: { value: "a" } });
  fireEvent.click(
    within(screen.getByRole("list", { name: "Productos encontrados" })).getByRole("button", {
      name: new RegExp(name),
    }),
  );
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

function quantity(name: string) {
  return screen.getByLabelText<HTMLInputElement>(`Cantidad de ${name}`);
}

/** Captura un valor en una celda y saca el foco de la fila (la línea se asienta). */
function capture(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function editedDot(name: string) {
  return within(row(name)).queryByRole("img", { name: "Línea editada" });
}

function editedSummary() {
  return screen.queryByRole("group", { name: "Líneas editadas" });
}

async function confirmAndGetBody(api: ReturnType<typeof installFetchStub>) {
  api.respondToNextPost({ data: { id: "purchase-lineas" } });
  fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-lineas"));

  return api.posts[0]?.body;
}

beforeEach(() => {
  mockPush.mockReset();
  mockResolveByCode.mockReset();
  window.localStorage.clear();
});

describe("PurchaseCreatePage · edición segura (COM-13)", () => {
  // Sin "Bloquear al agregar": aquí se edita una línea después de agregar otra.
  beforeEach(() => {
    window.localStorage.setItem(LOCK_ON_ADD_KEY, "0");
  });

  it("ningún campo de la pantalla es type=number: cantidad, costo, empaques, uds/empaque, costo por empaque y descuento", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Refresco Cola");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tipo de empaque de Refresco Cola" }),
      { target: { value: "custom:Bulto" } },
    );

    const numeric = [
      quantity("Cable HDMI"),
      screen.getByLabelText("Costo unitario BS de Cable HDMI"),
      screen.getByLabelText("Cantidad de bulto de Refresco Cola"),
      screen.getByLabelText("Unidades por bulto de Refresco Cola"),
      screen.getByLabelText("Costo por bulto BS de Refresco Cola"),
      screen.getByLabelText("Descuento REF"),
    ];

    for (const field of numeric) {
      expect(field).toHaveAttribute("type", "text");
      expect(field).toHaveAttribute("inputmode");
    }
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("la rueda sobre la cantidad enfocada no cambia el valor", async () => {
    const user = userEvent.setup();
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    capture(quantity("Cable HDMI"), "5");

    await user.click(quantity("Cable HDMI"));
    expect(quantity("Cable HDMI")).toHaveFocus();

    fireEvent.wheel(quantity("Cable HDMI"), { deltaY: 120 });
    fireEvent.wheel(quantity("Cable HDMI"), { deltaY: -120 });

    expect(quantity("Cable HDMI")).toHaveValue("5");
    expect(editedDot("Cable HDMI")).not.toBeInTheDocument();
  });

  it("la primera captura no cuenta; cambiar la cantidad después marca la fila y sale en el resumen con antes → después", async () => {
    const user = userEvent.setup();
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");

    // Primera captura: la línea nace con el foco en Cantidad y su valor seleccionado;
    // se teclean cantidad y costo sin salir de la fila, y luego se sale.
    expect(quantity("Cable HDMI")).toHaveFocus();
    await user.keyboard("5");
    await user.tab();
    expect(screen.getByLabelText("Costo unitario BS de Cable HDMI")).toHaveFocus();
    await user.keyboard("1000");
    await user.click(searchBox());

    expect(quantity("Cable HDMI")).toHaveValue("5");
    expect(editedDot("Cable HDMI")).not.toBeInTheDocument();
    expect(editedSummary()).not.toBeInTheDocument();

    await user.click(quantity("Cable HDMI"));
    await user.keyboard("8");
    await user.click(searchBox());

    expect(editedDot("Cable HDMI")).toHaveAttribute("title", "Línea editada");
    const summary = within(editedSummary() as HTMLElement);
    expect(summary.getByText("1 línea editada tras ser agregada")).toBeInTheDocument();
    expect(summary.getByRole("listitem")).toHaveTextContent("Cable HDMI · Cantidad 5 → 8");
    // El bloque de revisión queda antes del botón de confirmar.
    expect(
      (editedSummary() as HTMLElement).compareDocumentPosition(
        screen.getByRole("button", { name: /Confirmar Compra/ }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("el resumen cuenta en plural y dice qué cambió en cada línea: costo, empaques y alícuota", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Refresco Cola");
    // Agregar el segundo asentó el primero; el segundo se asienta al salir de su fila.
    fireEvent.blur(screen.getByLabelText("Cantidad de caja de Refresco Cola"));

    capture(screen.getByLabelText("Costo unitario BS de Cable HDMI"), "1100,5");
    capture(screen.getByLabelText("Cantidad de caja de Refresco Cola"), "3");
    fireEvent.click(screen.getByRole("button", { name: /^IVA de Refresco Cola: / }));
    fireEvent.click(screen.getByRole("radio", { name: /Reducida/ }));

    const items = within(editedSummary() as HTMLElement).getAllByRole("listitem");

    expect(
      within(editedSummary() as HTMLElement).getByText("2 líneas editadas tras ser agregadas"),
    ).toBeInTheDocument();
    expect(items[0]).toHaveTextContent(
      "Refresco Cola · Empaques 1 → 3 · IVA General 16 % → Reducida 8 %",
    );
    expect(items[1]).toHaveTextContent("Cable HDMI · Costo Bs. 1.020,00 → Bs. 1.100,50");
  });

  it("Esc deshace el último cambio de la celda: a medio escribir y ya confirmado", async () => {
    const user = userEvent.setup();
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    capture(quantity("Cable HDMI"), "5");
    await user.click(searchBox());

    // A medio escribir: vuelve al valor que tenía al entrar.
    await user.click(quantity("Cable HDMI"));
    await user.keyboard("8");
    expect(quantity("Cable HDMI")).toHaveValue("8");
    await user.keyboard("{Escape}");
    expect(quantity("Cable HDMI")).toHaveValue("5");
    expect(within(row("Cable HDMI")).getByText("Bs. 5.100,00")).toBeInTheDocument();

    // Ya confirmado (salió de la celda): Esc al volver restaura el valor anterior.
    await user.keyboard("9");
    await user.click(searchBox());
    expect(editedDot("Cable HDMI")).toBeInTheDocument();

    await user.click(quantity("Cable HDMI"));
    await user.keyboard("{Escape}");
    expect(quantity("Cable HDMI")).toHaveValue("5");
    expect(editedDot("Cable HDMI")).not.toBeInTheDocument();
    expect(editedSummary()).not.toBeInTheDocument();

    // Sin nada que deshacer no hace nada.
    await user.keyboard("{Escape}");
    expect(quantity("Cable HDMI")).toHaveValue("5");
  });

  it("volver a agregar un producto que ya está suma 1 y cuenta como edición", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Cable HDMI");

    expect(lineRows()).toHaveLength(1);
    expect(quantity("Cable HDMI")).toHaveValue("2");
    expect(editedDot("Cable HDMI")).toBeInTheDocument();
    expect(editedSummary()).toHaveTextContent("Cable HDMI · Cantidad 1 → 2");
  });

  it("cambiar el empaque después cuenta; la moneda de la compra y la compra exenta no", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");
    fireEvent.blur(quantity("Harina PAN"));

    fireEvent.click(screen.getByRole("button", { name: "REF" }));
    fireEvent.click(screen.getByRole("switch", { name: "Compra exenta" }));
    expect(editedSummary()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Empaque de Cable HDMI" }));
    expect(editedDot("Cable HDMI")).toBeInTheDocument();
    expect(editedSummary()).toHaveTextContent("Cable HDMI · Empaque Por unidad → Bulto × 1 u");
  });

  it("lo editado no viaja al backend: el payload es el de siempre", async () => {
    const api = installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    capture(quantity("Cable HDMI"), "5");
    capture(quantity("Cable HDMI"), "8");
    expect(editedDot("Cable HDMI")).toBeInTheDocument();

    const body = await confirmAndGetBody(api);

    expect(body).toEqual({
      clientRequestId: expect.any(String),
      discountRef: 0,
      discountVes: 0,
      items: [
        {
          costCurrency: "ves",
          entryMode: "unit",
          productId: "prod-cable",
          quantity: 8,
          subtotalRef: 16,
          subtotalVes: 8160,
          taxRate: 0,
          taxRateCode: "exento",
          taxRef: 0,
          taxVes: 0,
          unitCostRef: 2,
          unitCostVes: 1020,
        },
      ],
      refRateVes: 510,
      status: "recibido",
      subtotalRef: 16,
      subtotalVes: 8160,
      supplierId: "cont-supplier",
      taxRef: 0,
      taxVes: 0,
    });
  });
});

function lockButton(name: string) {
  return within(row(name)).getByRole("button", { name: new RegExp(`^(Bloquear|Desbloquear) ${name}$`) });
}

function isLocked(name: string) {
  return row(name).getAttribute("data-locked") === "true";
}

function lockOnAddSwitch() {
  return screen.getByRole("switch", { name: "Bloquear al agregar" });
}

describe("PurchaseCreatePage · líneas bloqueables (COM-12)", () => {
  it("agregar una línea bloquea las anteriores y enfoca la Cantidad de la nueva", () => {
    installFetchStub(() => null);
    renderPage();

    addProduct("Cable HDMI");
    expect(lockOnAddSwitch()).toHaveAttribute("aria-checked", "true");
    expect(isLocked("Cable HDMI")).toBe(false);
    expect(quantity("Cable HDMI")).toHaveFocus();

    addProduct("Harina PAN");
    expect(isLocked("Cable HDMI")).toBe(true);
    expect(isLocked("Harina PAN")).toBe(false);
    expect(quantity("Harina PAN")).toHaveFocus();

    // Una línea que nace en modo empaque enfoca sus empaques, que es su cantidad.
    addProduct("Refresco Cola");
    expect(isLocked("Harina PAN")).toBe(true);
    expect(isLocked("Refresco Cola")).toBe(false);
    expect(screen.getByLabelText("Cantidad de caja de Refresco Cola")).toHaveFocus();
  });

  it("una fila bloqueada es solo lectura: sin input, select ni chips, y su único foco es el candado", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Refresco Cola");
    addProduct("Cable HDMI");
    capture(quantity("Cable HDMI"), "3");
    addProduct("Harina PAN");

    for (const name of ["Refresco Cola", "Cable HDMI"]) {
      const locked = row(name);

      expect(locked.querySelectorAll("input, select, textarea, [contenteditable]")).toHaveLength(0);
      expect(within(locked).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(locked).queryByRole("combobox")).not.toBeInTheDocument();
      expect(locked.querySelectorAll("button, a[href], [tabindex]")).toHaveLength(1);
      expect(lockButton(name)).toHaveAccessibleName(`Desbloquear ${name}`);
      expect(lockButton(name)).toHaveAttribute("aria-pressed", "true");
      expect(within(locked).queryByRole("button", { name: `Quitar ${name}` })).not.toBeInTheDocument();
    }

    // Producto · cantidad (o empaques × uds) · costo · total · alícuota, como texto.
    expect(row("Cable HDMI")).toHaveTextContent("Cable HDMI");
    expect(row("Cable HDMI")).toHaveTextContent("ELE-CAB-001 · IVA Exento 0 %");
    expect(within(row("Cable HDMI")).getByText("3 u")).toBeInTheDocument();
    expect(within(row("Cable HDMI")).getByText("Bs. 1.020,00")).toBeInTheDocument();
    expect(within(row("Cable HDMI")).getByText("Bs. 3.060,00")).toBeInTheDocument();
    expect(within(row("Refresco Cola")).getByText("1 × 12 u")).toBeInTheDocument();
    expect(within(row("Refresco Cola")).getByText("Caja · 12 u")).toBeInTheDocument();
    expect(row("Refresco Cola")).toHaveTextContent("IVA General 16 %");

    // La rueda y el teclado sobre la fila bloqueada no tienen dónde actuar.
    fireEvent.wheel(row("Cable HDMI"), { deltaY: 120 });
    fireEvent.keyDown(row("Cable HDMI"), { key: "9" });
    expect(within(row("Cable HDMI")).getByText("3 u")).toBeInTheDocument();
  });

  it("Tab recorre los candados de las filas bloqueadas, nunca una celda", async () => {
    const user = userEvent.setup();
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");
    addProduct("Refresco Cola");
    fireEvent.click(screen.getByRole("button", { name: "Bloquear todas" }));

    await user.click(searchBox());
    const visited: Element[] = [];
    for (let step = 0; step < 12; step += 1) {
      await user.tab();
      if (document.activeElement) {
        visited.push(document.activeElement);
      }
    }

    const list = screen.getByRole("list", { name: "Líneas de la compra" });
    const insideList = visited.filter((element) => list.contains(element));

    expect(insideList).toEqual([
      lockButton("Refresco Cola"),
      lockButton("Harina PAN"),
      lockButton("Cable HDMI"),
    ]);
    expect(visited.some((element) => element.tagName === "INPUT" && list.contains(element))).toBe(
      false,
    );
  });

  it("el candado y el doble clic desbloquean; el candado vuelve a bloquear y conserva el foco", async () => {
    const user = userEvent.setup();
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");
    addProduct("Refresco Cola");

    await user.dblClick(within(row("Cable HDMI")).getByText("Cable HDMI"));
    expect(isLocked("Cable HDMI")).toBe(false);
    expect(quantity("Cable HDMI")).toBeInTheDocument();
    expect(within(row("Cable HDMI")).getByRole("button", { name: "Quitar Cable HDMI" })).toBeInTheDocument();

    await user.click(lockButton("Harina PAN"));
    expect(isLocked("Harina PAN")).toBe(false);
    expect(lockButton("Harina PAN")).toHaveAccessibleName("Bloquear Harina PAN");
    expect(lockButton("Harina PAN")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(isLocked("Harina PAN")).toBe(true);
    expect(lockButton("Harina PAN")).toHaveFocus();
  });

  it("una línea bloqueada no se puede quitar: hay que desbloquearla", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");

    expect(screen.queryByRole("button", { name: "Quitar Cable HDMI" })).not.toBeInTheDocument();

    fireEvent.click(lockButton("Cable HDMI"));
    fireEvent.click(screen.getByRole("button", { name: "Quitar Cable HDMI" }));
    expect(lineRows()).toHaveLength(1);
  });

  it("con la preferencia apagada no bloquea, y la preferencia se recuerda", () => {
    installFetchStub(() => null);
    const first = render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
    addProduct("Cable HDMI");

    fireEvent.click(lockOnAddSwitch());
    expect(lockOnAddSwitch()).toHaveAttribute("aria-checked", "false");
    expect(window.localStorage.getItem(LOCK_ON_ADD_KEY)).toBe("0");

    addProduct("Harina PAN");
    expect(isLocked("Cable HDMI")).toBe(false);
    expect(isLocked("Harina PAN")).toBe(false);
    expect(quantity("Harina PAN")).toHaveFocus();
    first.unmount();

    // Otra compra, otro día: sigue apagada.
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");
    expect(lockOnAddSwitch()).toHaveAttribute("aria-checked", "false");
    expect(isLocked("Cable HDMI")).toBe(false);

    // Y al volver a activarla, vuelve a bloquear.
    fireEvent.click(lockOnAddSwitch());
    expect(window.localStorage.getItem(LOCK_ON_ADD_KEY)).toBe("1");
    addProduct("Refresco Cola");
    expect(isLocked("Cable HDMI")).toBe(true);
    expect(isLocked("Harina PAN")).toBe(true);
  });

  it("Bloquear todas y luego agregar: la nueva nace libre; Desbloquear todas las abre", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");

    const lockAll = screen.getByRole("button", { name: "Bloquear todas" });
    const unlockAll = screen.getByRole("button", { name: "Desbloquear todas" });

    fireEvent.click(lockAll);
    expect(lineRows().every((line) => line.getAttribute("data-locked") === "true")).toBe(true);
    expect(lockAll).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /^(Cantidad|Costo)/ })).not.toBeInTheDocument();

    addProduct("Refresco Cola");
    expect(isLocked("Refresco Cola")).toBe(false);
    expect(screen.getByLabelText("Cantidad de caja de Refresco Cola")).toHaveFocus();
    expect(isLocked("Cable HDMI")).toBe(true);
    expect(isLocked("Harina PAN")).toBe(true);

    fireEvent.click(unlockAll);
    expect(lineRows().some((line) => line.getAttribute("data-locked") === "true")).toBe(false);
    expect(unlockAll).toBeDisabled();
  });

  it("el lector con todas bloqueadas: la línea nueva nace libre y con el foco en Cantidad", async () => {
    installFetchStub(() => null);
    mockResolveByCode.mockResolvedValue({
      product: {
        barcode: "7591234567890",
        costWithTaxRef: 1.16,
        currentStock: 7,
        link: "none",
        name: "Harina Suelta",
        packUnits: [],
        productId: "prod-suelta",
        sku: "HAR-SUE",
        taxRate: 16,
        unitCostRef: 1,
      },
      status: "found",
    });
    renderPage();
    addProduct("Cable HDMI");
    fireEvent.click(screen.getByRole("button", { name: "Bloquear todas" }));

    fireEvent.change(searchBox(), { target: { value: "7591234567890" } });
    fireEvent.keyDown(searchBox(), { key: "Enter" });

    await waitFor(() => expect(quantity("Harina Suelta")).toHaveFocus());
    expect(mockResolveByCode).toHaveBeenCalledWith("cont-supplier", "7591234567890");
    expect(isLocked("Harina Suelta")).toBe(false);
    expect(isLocked("Cable HDMI")).toBe(true);
  });

  it("agregar un producto que ya está bloqueado lo desbloquea, suma 1, enfoca su Cantidad y cuenta como editada", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    addProduct("Harina PAN");
    expect(isLocked("Cable HDMI")).toBe(true);

    addProduct("Cable HDMI");

    expect(lineRows()).toHaveLength(2);
    expect(isLocked("Cable HDMI")).toBe(false);
    expect(isLocked("Harina PAN")).toBe(true);
    expect(quantity("Cable HDMI")).toHaveValue("2");
    expect(quantity("Cable HDMI")).toHaveFocus();
    expect(editedDot("Cable HDMI")).toBeInTheDocument();
    expect(editedSummary()).toHaveTextContent("Cable HDMI · Cantidad 1 → 2");
  });

  it("bloquear apaga el punto de la fila pero la línea sigue en el resumen de editadas", () => {
    installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    capture(quantity("Cable HDMI"), "5");
    capture(quantity("Cable HDMI"), "8");
    expect(editedDot("Cable HDMI")).toBeInTheDocument();

    fireEvent.click(lockButton("Cable HDMI"));
    expect(isLocked("Cable HDMI")).toBe(true);
    expect(editedDot("Cable HDMI")).not.toBeInTheDocument();
    expect(editedSummary()).toHaveTextContent("1 línea editada tras ser agregada");
    expect(editedSummary()).toHaveTextContent("Cable HDMI · Cantidad 5 → 8");

    // Al desbloquear sigue apagado hasta que se vuelva a cambiar.
    fireEvent.click(lockButton("Cable HDMI"));
    expect(editedDot("Cable HDMI")).not.toBeInTheDocument();
    capture(quantity("Cable HDMI"), "9");
    expect(editedDot("Cable HDMI")).toBeInTheDocument();
    expect(editedSummary()).toHaveTextContent("Cable HDMI · Cantidad 5 → 9");
  });

  it("el bloqueo no viaja al backend: mismo payload con líneas bloqueadas y editadas", async () => {
    const api = installFetchStub(() => null);
    renderPage();
    addProduct("Cable HDMI");
    capture(quantity("Cable HDMI"), "3");
    addProduct("Refresco Cola");
    capture(screen.getByLabelText("Cantidad de caja de Refresco Cola"), "2");
    fireEvent.click(screen.getByRole("button", { name: "Bloquear todas" }));

    const body = await confirmAndGetBody(api);

    expect(body).toEqual({
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
        },
        {
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
        },
      ],
      refRateVes: 510,
      status: "recibido",
      subtotalRef: 30,
      subtotalVes: 15300,
      supplierId: "cont-supplier",
      taxRef: 3.84,
      taxVes: 1958.4,
    });
    expect(JSON.stringify(body)).not.toMatch(/lock|edited|changes|review|bloque/i);
  });
});
