/** INV-05 · punto de entrada de la reposición: solo con permiso de crear compras. */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPermission = {
  can: (permission: string) => permission.length > 0,
  isLoading: false,
  profile: { storeId: "store-1", user: { id: "user-1" } },
};

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => mockPermission,
}));

import { RestockPurchaseButton } from "./RestockPurchaseButton";

const CREATE = "Crear compra con estos productos";
/** Permisos del vendedor y del contador: ninguno crea compras. */
const VENDEDOR = ["dashboard.view", "sales.create", "products.view"];
const CONTADOR = ["dashboard.view", "purchases.view", "reports.view"];

describe("RestockPurchaseButton", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockPermission.can = () => true;
    mockPermission.isLoading = false;
    fetchMock = jest.fn(async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({ data: { items: [], limit: 50, skip: 0, total: 0 } }),
      ok: true,
      status: 200,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function renderButton() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <RestockPurchaseButton />
      </QueryClientProvider>,
    );
  }

  it.each([
    ["vendedor", VENDEDOR],
    ["contador", CONTADOR],
  ])("el %s no lo ve y no se pide nada", (_role, permissions) => {
    mockPermission.can = (permission) => permissions.includes(permission);

    const { container } = renderButton();

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no se pinta mientras cargan los permisos", () => {
    mockPermission.isLoading = true;

    const { container } = renderButton();

    expect(container).toBeEmptyDOMElement();
  });

  it("con `purchases.create` muestra el botón y no pide la lista hasta abrir", async () => {
    const user = userEvent.setup();

    mockPermission.can = (permission) => permission === "purchases.create";
    renderButton();

    const button = screen.getByRole("button", { name: CREATE });

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(button);

    expect(await screen.findByRole("dialog", { name: "Reponer productos" })).toBeInTheDocument();
    expect(await screen.findByText("No hay productos por reponer.")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/inventory?limit=50&lowStock=true&skip=0");
  });
});
