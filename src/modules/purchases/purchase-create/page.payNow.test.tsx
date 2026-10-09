import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/** COM-06 · sección opcional "Pagar ahora" de `/purchases/create`. */

const mockPush = jest.fn();
const mockRate = { data: { rateVes: 510 }, error: null };
const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    {
      code: "exento",
      id: "tax-exento",
      isActive: true,
      isDefault: false,
      isGlobal: true,
      label: "Exento",
      pct: 0,
      sortOrder: 10,
    },
  ],
  refetch: jest.fn(),
};
// Permisos que el rol NO tiene; vacío = admin.
let mockDenied: string[] = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockRate,
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => !mockDenied.includes(permission),
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../contacts/hooks/useSupplierProducts", () => ({
  useSupplierProducts: () => ({ data: undefined, error: null, isFetching: false }),
}));
// Proveedor y buscador reducidos a un botón: el test es del pago inicial.
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

/** CNF-01: «Confirmar Compra» abre la confirmación; la compra se envía con el botón del modal. */
function acceptConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: /^Registrar (compra|pedido)$/ }));
}

const UUID = /^[0-9a-f-]{36}$/;

function installApi() {
  return installFetchStub((url) =>
    url.startsWith("/api/settings/payment-methods")
      ? { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd", "transferencia"] }
      : null,
  );
}

/** Una línea de 1 u a REF 2,00 exenta: total REF 2,00 = Bs 1.020,00. */
function renderWithCart() {
  const QueryWrapper = createQueryWrapper();

  const view = render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));

  return view;
}

const toggle = () => screen.getByRole("button", { name: /Pagar ahora/ });
const confirm = () => screen.getByRole("button", { name: /Confirmar Compra/ });
const amountField = () => screen.getByLabelText("Monto");

describe("PurchaseCreatePage · Pagar ahora (COM-06)", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockDenied = [];
  });

  it("la sección nace colapsada, sin input[type=number], y confirmar así no envía initialPayment", async () => {
    const api = installApi();
    api.respondToNextPost({ data: { id: "purchase-1" } });

    renderWithCart();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Monto")).not.toBeVisible();
    expect(document.body.querySelector('input[type="number"]')).toBeNull();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(document.body.querySelector('input[type="number"]')).toBeNull();
    fireEvent.click(toggle());

    fireEvent.click(confirm());
    acceptConfirmation();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).not.toHaveProperty("initialPayment");
  });

  it("sin permiso para registrar pagos la sección no existe", () => {
    mockDenied = ["payments.manage"];
    installApi();

    renderWithCart();

    expect(screen.queryByRole("button", { name: /Pagar ahora/ })).not.toBeInTheDocument();
  });

  it("sin permiso de pagos la pantalla no pide los métodos de pago (para almacén responde 403); con permiso sí (COM-F3)", async () => {
    const paymentMethodRequests = () =>
      (global.fetch as jest.Mock).mock.calls.filter(([url]) =>
        String(url).startsWith("/api/settings/payment-methods"),
      );

    for (const denied of [["payments.manage"], ["payments.view"], ["payments.manage", "payments.view"]]) {
      mockDenied = denied;
      installApi();

      const { unmount } = renderWithCart();

      // Un turno para que una consulta habilitada llegara a salir.
      await waitFor(() => expect(confirm()).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paymentMethodRequests()).toHaveLength(0);
      unmount();
    }

    mockDenied = [];
    installApi();
    renderWithCart();

    await waitFor(() => expect(paymentMethodRequests()).toHaveLength(1));
  });

  it("las consultas opcionales no salen sin el permiso de su endpoint: recetas sin inventory.view, precios sin products.manage (COM-F6)", async () => {
    const requestsTo = (path: string) =>
      (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith(path));

    mockDenied = ["inventory.view", "products.manage"];
    installApi();

    const { unmount } = renderWithCart();

    // Un turno para que una consulta habilitada llegara a salir.
    await waitFor(() => expect(confirm()).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestsTo("/api/inventory/pack-conversions")).toHaveLength(0);
    expect(requestsTo("/api/settings/pricing")).toHaveLength(0);
    unmount();

    mockDenied = [];
    installApi();
    renderWithCart();

    await waitFor(() => expect(requestsTo("/api/inventory/pack-conversions")).toHaveLength(1));
    await waitFor(() => expect(requestsTo("/api/settings/pricing")).toHaveLength(1));
  });

  it("Completar saldo pone el total de la compra y confirmar envía initialPayment con su propia clave", async () => {
    const api = installApi();
    api.respondToNextPost({
      data: { id: "purchase-1", initialPayment: { paymentId: "pay-1", status: "registered" } },
    });

    renderWithCart();
    fireEvent.click(toggle());

    fireEvent.click(screen.getByRole("button", { name: "Completar saldo" }));
    expect(amountField()).toHaveValue("1020");

    fireEvent.click(confirm());
    acceptConfirmation();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/purchases");

    const body = api.posts[0]?.body as {
      clientRequestId: string;
      initialPayment: Record<string, unknown>;
    };

    expect(body.clientRequestId).toMatch(UUID);
    expect(body.initialPayment).toEqual({
      amount: 1020,
      clientRequestId: expect.stringMatching(UUID),
      currency: "VES",
      method: "efectivo_ves",
    });
    expect(body.initialPayment.clientRequestId).not.toBe(body.clientRequestId);
    // Pago registrado: la región de avisos sigue vacía.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("abierta pero incompleta: muestra el error en la sección y no envía nada; al completarla sí", async () => {
    const api = installApi();
    api.respondToNextPost({
      data: { id: "purchase-1", initialPayment: { paymentId: "pay-1", status: "registered" } },
    });

    renderWithCart();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText("Metodo"), { target: { value: "transferencia" } });
    fireEvent.click(confirm());
    // CNF-01: con el formulario inválido la confirmación no se abre.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const section = toggle().closest("section") as HTMLElement;

    expect(within(section).getByRole("alert")).toHaveTextContent(
      "Completa los datos del pago o desactiva «Pagar ahora»",
    );
    expect(within(section).getByText("Indica un monto mayor a cero.")).toBeInTheDocument();
    expect(within(section).getByText("Indica la referencia.")).toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();

    // Un monto mayor que el total tampoco sale: el servidor lo rechazaría.
    fireEvent.change(screen.getByLabelText("Metodo"), { target: { value: "efectivo_ves" } });
    fireEvent.change(amountField(), { target: { value: "5000" } });
    fireEvent.click(confirm());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "50 % del saldo" }));
    expect(amountField()).toHaveValue("510");
    fireEvent.click(confirm());
    acceptConfirmation();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body.initialPayment).toMatchObject({ amount: 510, method: "efectivo_ves" });
  });

  it("failed: navega igual al detalle y deja un aviso que no se cierra solo con el motivo del servidor", async () => {
    const api = installApi();
    api.respondToNextPost({
      data: {
        id: "purchase-1",
        initialPayment: {
          message: "Saldo insuficiente en el baul (efectivo). Faltante VES: 20.",
          status: "failed",
        },
      },
    });

    renderWithCart();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Completar saldo" }));
    fireEvent.click(confirm());
    acceptConfirmation();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    const notice = screen.getByRole("alert");

    await waitFor(() =>
      expect(notice).toHaveTextContent("La compra se registró, pero el pago no"),
    );
    expect(notice).toHaveTextContent(
      "Saldo insuficiente en el baul (efectivo). Faltante VES: 20. Puedes registrarlo desde aquí.",
    );
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red viaja con las mismas dos claves", async () => {
    const api = installApi();
    api.networkErrorOnNextPost();
    api.respondToNextPost({
      data: { id: "purchase-1", initialPayment: { paymentId: "pay-1", status: "registered" } },
    });

    renderWithCart();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Completar saldo" }));
    fireEvent.click(confirm());
    acceptConfirmation();
    await screen.findByText(/No pudimos conectar con el servidor/);

    // CNF-01: el reintento es el botón de la confirmación, que sigue abierta.
    acceptConfirmation();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    const [first, retry] = api.posts.map(
      (post) => post.body as { clientRequestId: string; initialPayment: { clientRequestId: string } },
    );

    expect(retry?.clientRequestId).toBe(first?.clientRequestId);
    expect(retry?.initialPayment.clientRequestId).toBe(first?.initialPayment.clientRequestId);
  });

  it("tras un rechazo definitivo, cambiar el pago estrena las dos claves", async () => {
    const api = installApi();
    api.respondToNextPost(
      { error: { code: "BAD_REQUEST", message: "La solicitud no tiene un formato valido." } },
      400,
    );
    api.respondToNextPost({
      data: { id: "purchase-1", initialPayment: { paymentId: "pay-1", status: "registered" } },
    });

    renderWithCart();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Completar saldo" }));
    fireEvent.click(confirm());
    acceptConfirmation();
    await screen.findByText("La solicitud no tiene un formato valido.");

    // CNF-01: para cambiar el pago hay que salir de la confirmación.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "25 % del saldo" }));
    fireEvent.click(confirm());
    acceptConfirmation();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    const [first, second] = api.posts.map(
      (post) => post.body as { clientRequestId: string; initialPayment: { clientRequestId: string } },
    );

    expect(second?.clientRequestId).not.toBe(first?.clientRequestId);
    expect(second?.initialPayment.clientRequestId).not.toBe(first?.initialPayment.clientRequestId);
  });
});
