import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PurchaseCatalogProduct } from "./components/PurchaseProductPickerCard";

const mockPush = jest.fn();
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
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
// El buscador real con un catálogo fijo: cualquier texto devuelve los tres productos.
jest.mock("./hooks/usePurchaseProductSearch", () => ({
  usePurchaseProductSearch: () => ({ catalog: mockCatalog, error: null, isSearching: false }),
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
  window.localStorage.clear();
});

describe("PurchaseCreatePage · edición segura (COM-13)", () => {
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

    // Primera captura: cantidad y costo sin salir de la fila, y luego fuera.
    await user.click(quantity("Cable HDMI"));
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
