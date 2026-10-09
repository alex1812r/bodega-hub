/** INV-05 · la tarjeta de bajo stock ofrece "Crear compra con estos productos" solo con permiso. */
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

import { DashboardLowStockCard } from "./DashboardLowStockCard";

const CREATE = "Crear compra con estos productos";

describe("DashboardLowStockCard · reposición", () => {
  let requests: string[];

  beforeEach(() => {
    mockPermission.can = () => true;
    requests = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));

      return {
        headers: { get: () => "application/json" },
        json: async () => ({
          data: {
            items: [{ currentStock: 2, id: "p-1", minStock: 5, name: "Arroz", sku: "ARR-1" }],
            limit: 8,
            skip: 0,
            total: 1,
          },
        }),
        ok: true,
        status: 200,
      };
    }) as unknown as typeof fetch;
  });

  function renderCard(footer?: React.ReactNode) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <DashboardLowStockCard footer={footer} totalCount={1} />
      </QueryClientProvider>,
    );
  }

  it("con permiso de crear compras abre la reposición desde el pie de la tarjeta", async () => {
    const user = userEvent.setup();

    renderCard();

    expect(await screen.findByText("Arroz")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Generar orden de compra" })).toHaveAttribute(
      "href",
      "/purchases/create",
    );

    await user.click(screen.getByRole("button", { name: CREATE }));

    expect(await screen.findByRole("dialog", { name: "Reponer productos" })).toBeInTheDocument();
    expect(requests.some((request) => request.startsWith("/api/inventory?"))).toBe(true);
  });

  it("sin permiso de crear compras no lo muestra", async () => {
    mockPermission.can = (permission) => permission !== "purchases.create";
    renderCard();

    expect(await screen.findByText("Arroz")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CREATE })).not.toBeInTheDocument();
  });

  it("con un pie propio (panel de plataforma) no se añade", async () => {
    renderCard(<p>Pie de plataforma</p>);

    expect(await screen.findByText("Pie de plataforma")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CREATE })).not.toBeInTheDocument();
  });
});
