import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockPush = jest.fn();
// La misma lista en cada render: una nueva relanzaría el efecto que funde el catálogo.
const mockCatalog: never[] = [];
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
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("./hooks/usePurchaseProductSearch", () => ({
  usePurchaseProductSearch: () => ({ catalog: mockCatalog, error: null, isSearching: false }),
}));
// Proveedor y buscador reducidos a un botón: el test es del aviso de Confirmar.
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: ({ onSupplierChange }: { onSupplierChange: (id: string) => void }) => (
    <button onClick={() => onSupplierChange("cont-supplier")} type="button">
      elegir proveedor
    </button>
  ),
}));
jest.mock("./components/PurchaseProductPickerCard", () => ({
  PurchaseProductPickerCard: ({
    onAddProduct,
  }: {
    onAddProduct: (product: Record<string, unknown>) => void;
  }) => (
    <button
      onClick={() =>
        onAddProduct({
          costWithTaxRef: 2,
          currentStock: 5,
          link: "none",
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
  ),
}));

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";

import { PurchaseCreatePage } from "./page";

const TITLE = "No pudimos registrar la compra";
const NETWORK_MESSAGE =
  "No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentar; no se duplicará la compra.";
const scrollIntoView = jest.fn();

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
}

function confirm() {
  return screen.getByRole("button", { name: /Confirmar Compra/ });
}

function addSupplierAndProduct() {
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
}

/** El aviso de Confirmar: dentro de la tarjeta de resumen, junto al botón. */
function confirmAlert() {
  const card = confirm().closest("section") as HTMLElement;

  return within(card).getByRole("alert");
}

beforeEach(() => {
  mockPush.mockReset();
  scrollIntoView.mockReset();
  window.localStorage.clear();
  // jsdom no trae `scrollIntoView`.
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

// COM-F10 · F-A3: el aviso se pintaba arriba del formulario, fuera de la vista.
describe("PurchaseCreatePage · el error de Confirmar se ve junto al botón (COM-F10 · F-A3)", () => {
  it("un 500 del servidor: su mensaje tal cual, en un solo aviso junto al botón, y se desplaza hasta él", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost(
      { error: { code: "INTERNAL", message: "No se pudo registrar la compra en este momento." } },
      500,
    );

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());

    await waitFor(() => expect(confirmAlert()).toHaveTextContent(TITLE));
    expect(confirmAlert()).toHaveTextContent("No se pudo registrar la compra en este momento.");
    // Uno solo: no se repite arriba del formulario.
    expect(screen.getAllByText(TITLE)).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(confirmAlert());
    expect(confirm()).toBeEnabled();
  });

  it("un 409 muestra el mensaje del servidor sin tocarlo", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost(
      { error: { code: "CONFLICT", message: "La compra ya fue registrada con otro contenido." } },
      409,
    );

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());

    await waitFor(() =>
      expect(confirmAlert()).toHaveTextContent("La compra ya fue registrada con otro contenido."),
    );
  });

  it("un fallo de red no muestra «Failed to fetch»: dice en español que se puede reintentar", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());

    await waitFor(() => expect(confirmAlert()).toHaveTextContent(NETWORK_MESSAGE));
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it("los errores de validación propios también salen junto al botón y vuelven a desplazar en cada intento", () => {
    installFetchStub(() => null);
    renderPage();

    fireEvent.click(confirm());
    expect(confirmAlert()).toHaveTextContent(
      "Selecciona un proveedor antes de confirmar la compra.",
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // El mismo error otra vez: el aviso ya está, pero se vuelve a traer a la vista.
    fireEvent.click(confirm());
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
    fireEvent.click(confirm());
    expect(confirmAlert()).toHaveTextContent("Agrega al menos un producto");
    expect(screen.getAllByText(TITLE)).toHaveLength(1);
  });

  it("el pago incompleto se anuncia una sola vez y se ve también junto al botón", () => {
    installFetchStub(() => null);
    renderPage();
    addSupplierAndProduct();
    fireEvent.click(screen.getByRole("button", { name: /Pagar ahora/ }));
    fireEvent.click(confirm());

    const MESSAGE = /Completa los datos del pago o desactiva «Pagar ahora»/;
    const card = confirm().closest("section") as HTMLElement;

    expect(within(card).getByText(MESSAGE)).toBeInTheDocument();
    expect(
      screen.getAllByRole("alert").filter((alert) => MESSAGE.test(alert.textContent ?? "")),
    ).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("sin `scrollIntoView` (jsdom) el aviso aparece igual", async () => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");

    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());

    await waitFor(() => expect(confirmAlert()).toHaveTextContent(NETWORK_MESSAGE));
  });

  it("al reintentar con éxito el aviso desaparece", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    const release = api.holdNextPost({ data: { id: "purchase-1" } });

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());
    await waitFor(() => expect(confirmAlert()).toBeInTheDocument());

    fireEvent.click(confirm());
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());

    await act(async () => {
      release();
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));
  });
});
