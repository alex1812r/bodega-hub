import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/** CNF-01 · «Confirmar Compra» abre una confirmación con el efecto concreto de ESA compra. */

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
  useSearchParams: () => new URLSearchParams(),
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
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: ({
    onSupplierChange,
  }: {
    onSupplierChange: (id: string, name?: string) => void;
  }) => (
    <button onClick={() => onSupplierChange("cont-supplier", "Distribuidora Demo")} type="button">
      elegir proveedor
    </button>
  ),
}));
// El buscador reducido a dos botones: cada uno entrega un producto, como lo haría la
// lista o la cola de escaneos (`usePurchaseScanQueue`) al resolver un código.
jest.mock("./components/PurchaseProductPickerCard", () => ({
  PurchaseProductPickerCard: ({
    onAddProduct,
  }: {
    onAddProduct: (product: Record<string, unknown>, options?: { scanned?: boolean }) => void;
  }) => (
    <>
      <button
        onClick={() =>
          onAddProduct({
            costWithTaxRef: 1.5,
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
      <button
        onClick={() =>
          onAddProduct(
            {
              costWithTaxRef: 3,
              currentStock: 0,
              link: "linked",
              name: "Harina PAN",
              packUnits: [],
              productId: "prod-harina",
              sku: "VIV-HAR-001",
              taxRate: 0,
              unitCostRef: 3,
            },
            { scanned: true },
          )
        }
        type="button"
      >
        llega un escaneo
      </button>
    </>
  ),
}));

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";

import { PurchaseCreatePage } from "./page";

const CHANGED = /La compra cambió mientras la confirmabas/;

/** Lo que el modal consulta: el proveedor no tiene el cable; el producto cuesta hoy REF 1,50. */
function installApi() {
  return installFetchStub((url) => {
    if (url.startsWith("/api/suppliers/cont-supplier/products")) {
      return { items: [], limit: 100, skip: 0, total: 0 };
    }

    if (url.startsWith("/api/settings/pricing")) {
      return { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 };
    }

    if (url.startsWith("/api/settings/payment-methods")) {
      return { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd", "transferencia"] };
    }

    if (url === "/api/products/prod-cable") {
      return { currentCostRef: 1.5, id: "prod-cable", salePriceRef: 2.5 };
    }

    if (url === "/api/products/prod-harina") {
      return { currentCostRef: 3, id: "prod-harina", salePriceRef: 4 };
    }

    return null;
  });
}

/** Una línea de 1 und a REF 2,00 exenta: total REF 2,00 = Bs 1.020,00. */
function renderWithCart() {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
}

const confirm = () => screen.getByRole("button", { name: /Confirmar Compra/ });
const dialog = () => screen.getByRole("dialog");
/** El aviso de Confirmar: dentro de la tarjeta de resumen, junto al botón. */
const confirmAlert = () =>
  within(confirm().closest("section") as HTMLElement).getByRole("alert");

async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockPush.mockReset();
  window.localStorage.clear();
});

describe("PurchaseCreatePage · confirmación con efecto (CNF-01)", () => {
  it("Confirmar Compra no envía nada: abre el modal con proveedor, líneas, total, tasa, costo anterior → nuevo y el vínculo nuevo", async () => {
    const api = installApi();

    renderWithCart();
    fireEvent.click(confirm());

    expect(within(dialog()).getByRole("heading", { name: "Confirmar compra" })).toBeInTheDocument();
    expect(within(dialog()).getByText("Distribuidora Demo")).toBeInTheDocument();
    expect(within(dialog()).getByText("1 línea")).toBeInTheDocument();
    expect(within(dialog()).getByText("ref 2.00 · Bs. 1.020,00")).toBeInTheDocument();
    expect(within(dialog()).getByText("Bs. 510,00 por REF")).toBeInTheDocument();
    expect(within(dialog()).getByText("Sin pago: queda por pagar")).toBeInTheDocument();
    expect(within(dialog()).getByText("1 und")).toBeInTheDocument();
    expect(within(dialog()).queryByText(/El inventario NO cambia/)).not.toBeInTheDocument();

    // Lo que la pantalla no tenía cargado llega de sus lecturas: costo de hoy y vínculo.
    expect(await within(dialog()).findByText("ref 1.50")).toBeInTheDocument();
    expect(within(dialog()).getByText("Vínculo nuevo con el proveedor")).toBeInTheDocument();
    // Precio 2,50: de 66,67 % (verde) a 25 % (sigue verde): no hay banda que avisar.
    expect(within(dialog()).queryByText("Ganancia")).not.toBeInTheDocument();

    expect(api.posts).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Cancelar cierra sin enviar y la compra sigue como estaba", async () => {
    const api = installApi();

    renderWithCart();
    fireEvent.click(confirm());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    await waitForDialogClosed();

    expect(api.posts).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
    expect(confirm()).toBeEnabled();

    // La compra sigue ahí: volver a confirmar muestra las mismas cifras.
    fireEvent.click(confirm());
    expect(within(dialog()).getByText("1 línea")).toBeInTheDocument();
    expect(within(dialog()).getByText("ref 2.00 · Bs. 1.020,00")).toBeInTheDocument();
  });

  it("doble clic en el botón del modal = UNA petición, con el payload de siempre", async () => {
    const api = installApi();
    const release = api.holdNextPost({ data: { id: "purchase-1" } });

    renderWithCart();
    fireEvent.click(confirm());

    const register = within(dialog()).getByRole("button", { name: "Registrar compra" });

    fireEvent.click(register);
    fireEvent.click(register);

    await waitFor(() =>
      expect(within(dialog()).getByRole("button", { name: /Procesando/ })).toBeDisabled(),
    );
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/purchases");
    // Ni una clave más ni una menos que antes del modal (regla 9).
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      discountRef: 0,
      discountVes: 0,
      items: [
        {
          costCurrency: "ves",
          entryMode: "unit",
          productId: "prod-cable",
          quantity: 1,
          subtotalRef: 2,
          subtotalVes: 1020,
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
      subtotalRef: 2,
      subtotalVes: 1020,
      supplierId: "cont-supplier",
      taxRef: 0,
      taxVes: 0,
    });

    await act(async () => {
      release();
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));
    await waitForDialogClosed();
    expect(api.posts).toHaveLength(1);
  });

  it("si llega una línea con el modal abierto (escaneo en cola) el modal se cierra, avisa y no confirma cifras viejas", async () => {
    const api = installApi();

    api.respondToNextPost({ data: { id: "purchase-2" } });
    renderWithCart();

    // El escaneo ya estaba en vuelo cuando se pulsó Confirmar: su línea llega después.
    const queuedScan = screen.getByRole("button", { name: "llega un escaneo" });

    fireEvent.click(confirm());

    const register = within(dialog()).getByRole("button", { name: "Registrar compra" });

    expect(within(dialog()).getByText("ref 2.00 · Bs. 1.020,00")).toBeInTheDocument();

    fireEvent.click(queuedScan);
    await waitForDialogClosed();

    // Ni siquiera un clic que ya iba hacia el botón envía la compra de antes.
    fireEvent.click(register);
    expect(api.posts).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
    expect(confirmAlert()).toHaveTextContent(CHANGED);

    // Al volver a confirmar, el modal ya es el de la compra de ahora.
    fireEvent.click(confirm());
    expect(screen.queryByText(CHANGED)).not.toBeInTheDocument();
    expect(within(dialog()).getByText("2 líneas")).toBeInTheDocument();
    expect(within(dialog()).getByText("ref 5.00 · Bs. 2.550,00")).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-2"));

    expect(api.posts).toHaveLength(1);
    expect(
      (api.posts[0]?.body.items as Array<{ productId: string }>)
        .map((item) => item.productId)
        .sort(),
    ).toEqual(["prod-cable", "prod-harina"]);
  });

  it("pedido: el modal avisa que el inventario NO cambia hasta recibir, no pinta costos y envía status pedido", async () => {
    const api = installApi();

    api.respondToNextPost({ data: { id: "purchase-3" } });
    renderWithCart();
    fireEvent.change(screen.getByLabelText(/Estado/), { target: { value: "pedido" } });
    fireEvent.click(confirm());

    expect(within(dialog()).getByRole("heading", { name: "Confirmar pedido" })).toBeInTheDocument();
    expect(
      within(dialog()).getByText(/El inventario NO cambia hasta recibir/),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByText("Costo (con IVA)")).not.toBeInTheDocument();
    expect(within(dialog()).queryByText("Entra")).not.toBeInTheDocument();
    // El vínculo sí nace con el pedido (COM-02).
    expect(await within(dialog()).findByText("Vínculo nuevo con el proveedor")).toBeInTheDocument();
    expect(within(dialog()).queryByText("ref 1.50")).not.toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Registrar pedido" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-3"));
    expect(api.posts[0]?.body.status).toBe("pedido");
  });

  it("con «Pagar ahora» el modal dice método, monto y de dónde sale, y el pago viaja como siempre", async () => {
    const api = installApi();

    api.respondToNextPost({
      data: { id: "purchase-4", initialPayment: { paymentId: "pay-1", status: "registered" } },
    });
    renderWithCart();
    fireEvent.click(screen.getByRole("button", { name: /Pagar ahora/ }));
    await waitFor(() =>
      expect(within(screen.getByLabelText("Metodo")).getByRole("option", { name: "Efectivo USD" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Metodo"), { target: { value: "efectivo_usd" } });
    fireEvent.click(screen.getByRole("button", { name: "Completar saldo" }));
    fireEvent.click(confirm());

    expect(
      within(dialog()).getByText("Efectivo USD · ref 2.00 (Bs. 1.020,00)"),
    ).toBeInTheDocument();
    expect(within(dialog()).getByText(/Sale del efectivo en USD del baúl/)).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-4"));
    expect(api.posts[0]?.body.initialPayment).toMatchObject({
      amount: 2,
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      currency: "USD",
      method: "efectivo_usd",
    });
  });

  it("el rechazo del servidor se lee tal cual en el modal y el reintento viaja con la misma clave", async () => {
    const api = installApi();

    api.respondToNextPost(
      { error: { code: "CONFLICT", message: "El producto Cable HDMI está inactivo." } },
      409,
    );
    api.respondToNextPost({ data: { id: "purchase-5" } });
    renderWithCart();
    fireEvent.click(confirm());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Registrar compra" }));

    await waitFor(() =>
      expect(within(dialog()).getByRole("alert")).toHaveTextContent(
        "El producto Cable HDMI está inactivo.",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-5"));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });

  it("con el formulario inválido el modal no se abre", () => {
    installApi();

    const QueryWrapper = createQueryWrapper();

    render(
      <QueryWrapper>
        <ToastProvider>
          <PurchaseCreatePage />
        </ToastProvider>
      </QueryWrapper>,
    );
    fireEvent.click(confirm());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirmAlert()).toHaveTextContent(
      "Selecciona un proveedor antes de confirmar la compra.",
    );
  });
});
