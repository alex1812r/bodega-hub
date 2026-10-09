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

import { onlineManager } from "@tanstack/react-query";

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";

import { PurchaseCreatePage } from "./page";

const TITLE = "No pudimos registrar la compra";
const NETWORK_MESSAGE =
  "No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentar; no se duplicará la compra.";
const SERVER_MESSAGE = "No pudimos registrar la compra. Inténtalo de nuevo; no se duplicará.";
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
  // COM-F11 · P3-4: un 5xx trae un mensaje técnico («unsupported Unicode escape sequence»).
  it.each([
    [500, { error: { code: "INTERNAL", message: "unsupported Unicode escape sequence" } }],
    [502, "<html>Bad Gateway</html>"],
  ])("un %i del servidor: un mensaje propio en vez del técnico, en un solo aviso junto al botón", async (status, payload) => {
    const api = installFetchStub(() => null);
    api.respondToNextPost(payload, status);

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());

    await waitFor(() => expect(confirmAlert()).toHaveTextContent(TITLE));
    expect(confirmAlert()).toHaveTextContent(SERVER_MESSAGE);
    expect(screen.queryByText(/unsupported Unicode/)).not.toBeInTheDocument();
    // Uno solo: no se repite arriba del formulario.
    expect(screen.getAllByText(TITLE)).toHaveLength(1);
    expect(confirm()).toBeEnabled();
  });

  // COM-F11 · P3-1: el aviso se insertaba donde estaba el botón y lo sacaba de la vista.
  it("el aviso va encima del botón y lo que se trae a la vista es el bloque con los dos", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Conflicto." } }, 409);

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());

    await waitFor(() => expect(confirmAlert()).toHaveTextContent("Conflicto."));

    const scrolled = scrollIntoView.mock.contexts.at(-1) as HTMLElement;

    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(scrolled).toContainElement(confirmAlert());
    expect(scrolled).toContainElement(confirm());
    expect(
      confirmAlert().compareDocumentPosition(confirm()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // COM-F11 · P3-2: el botón se deshabilita durante el envío y el navegador le quita el foco.
  it("tras un error del servidor el foco vuelve al botón Confirmar", async () => {
    const api = installFetchStub(() => null);
    const release = api.holdNextPost({ error: { code: "CONFLICT", message: "Conflicto." } }, 409);

    renderPage();
    addSupplierAndProduct();
    confirm().focus();
    fireEvent.click(confirm());

    const submitting = await screen.findByRole("button", { name: "Confirmando..." });

    expect(submitting).toBeDisabled();
    // Lo que hace el navegador con el botón deshabilitado: el foco cae al documento. jsdom no
    // lo hace solo (ni deja quitarle el foco con `blur`), así que se lleva a otro elemento
    // que se retira.
    const elsewhere = document.createElement("button");

    document.body.append(elsewhere);
    elsewhere.focus();
    elsewhere.remove();
    expect(document.body).toHaveFocus();

    await act(async () => {
      release();
    });

    await waitFor(() => expect(confirmAlert()).toHaveTextContent("Conflicto."));
    expect(confirm()).toHaveFocus();
  });

  it("mientras se corrige el pago no se le quita el foco al campo que se está editando", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Conflicto." } }, 409);

    renderPage();
    addSupplierAndProduct();
    fireEvent.click(confirm());
    await waitFor(() => expect(confirmAlert()).toHaveTextContent("Conflicto."));

    const notes = screen.getByPlaceholderText("Nro. de factura, condiciones...");

    notes.focus();
    fireEvent.change(notes, { target: { value: "Factura 12" } });

    expect(notes).toHaveFocus();
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
    expect(confirmAlert()).toHaveTextContent(
      "Agrega al menos un producto con cantidad y costo válidos.",
    );
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

// COM-F10 · F-A5: sin conexión el botón quedaba en «Confirmando...» sin mensaje.
describe("PurchaseCreatePage · confirmar sin conexión (COM-F10 · F-A5)", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("sin red: aviso visible y botón rehabilitado; el reintento reutiliza la clave y nada se envía solo", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "purchase-1" } });

    renderPage();
    addSupplierAndProduct();
    act(() => onlineManager.setOnline(false));
    fireEvent.click(confirm());

    await waitFor(() => expect(confirmAlert()).toHaveTextContent(NETWORK_MESSAGE));
    expect(confirm()).toBeEnabled();
    expect(confirm()).toHaveTextContent("Confirmar Compra");
    expect(api.posts).toHaveLength(1);

    // Vuelve la red: no hay envío automático, lo decide el usuario.
    act(() => onlineManager.setOnline(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.posts).toHaveLength(1);
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(confirm());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });
});
