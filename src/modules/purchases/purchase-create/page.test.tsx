import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
const mockSuppliers = {
  data: {
    items: [{ id: "cont-supplier", name: "Proveedor Demo", type: "proveedor" }],
    limit: 100,
    skip: 0,
    total: 1,
  },
  error: null,
};
const mockRate = { data: { rateVes: 510 }, error: null };
const mockSupplierProducts = { data: undefined, error: null, isFetching: false };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../../contacts/hooks/useContacts", () => ({
  useContacts: () => mockSuppliers,
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockRate,
}));
jest.mock("../../contacts/hooks/useSupplierProducts", () => ({
  useSupplierProducts: () => mockSupplierProducts,
}));
// Proveedor y buscador de productos reducidos a un boton: el test es del envio.
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

import { PurchaseCreatePage } from "./page";

function renderWithCart() {
  render(<PurchaseCreatePage />, { wrapper: createQueryWrapper() });
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
  fireEvent.click(screen.getByRole("button", { name: "agregar producto" }));
}

describe("PurchaseCreatePage · idempotencia (C6)", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("doble clic en Confirmar = un solo POST, con clave, y navega con la compra del servidor", async () => {
    const api = installFetchStub(() => null);
    const release = api.holdNextPost({ data: { id: "purchase-del-servidor" } });

    renderWithCart();

    const confirm = screen.getByRole("button", { name: /Confirmar Compra/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByRole("button", { name: /Confirmando/ })).toBeDisabled());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/purchases");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      supplierId: "cont-supplier",
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-del-servidor"));
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la misma clave", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "purchase-1" } });

    renderWithCart();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await screen.findByText("Failed to fetch");
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1"));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
    expect(api.posts[1]?.body.items).toEqual(api.posts[0]?.body.items);
  });
});
