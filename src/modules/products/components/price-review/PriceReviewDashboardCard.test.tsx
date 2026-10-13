import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

let mockPermissions: string[] = [];

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.includes(permission),
    isLoading: false,
    role: "admin",
  }),
}));

import { PriceReviewDashboardCard } from "./PriceReviewDashboardCard";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("PriceReviewDashboardCard", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    mockPermissions = ["products.view"];
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  function renderCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <main>
          <p>Resto del dashboard</p>
          <PriceReviewDashboardCard />
        </main>
      </QueryClientProvider>,
    );
  }

  it("links to the filtered list with the number of products that dropped", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { total: 3 } }));
    renderCard();

    const link = await screen.findByRole("link", { name: /3 productos bajaron de ganancia.*Revisar/ });

    expect(link).toHaveAttribute("href", "/products?review=1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/products/price-review/summary");
  });

  it("uses the singular for one product", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { total: 1 } }));
    renderCard();

    expect(await screen.findByText("1 producto bajó de ganancia")).toBeInTheDocument();
  });

  it("shows nothing with zero products", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { total: 0 } }));
    renderCard();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("link")).not.toBeInTheDocument());
    expect(screen.getByText("Resto del dashboard")).toBeInTheDocument();
  });

  it.each([403, 500])("shows nothing and keeps the dashboard alive on a %i", async (status) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "ERROR", message: "No disponible." } }, status),
    );
    renderCard();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("link")).not.toBeInTheDocument());
    expect(screen.getByText("Resto del dashboard")).toBeInTheDocument();
  });

  it("shows nothing while the summary is loading", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderCard();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Resto del dashboard")).toBeInTheDocument();
  });

  it("does not even ask without products.view", () => {
    mockPermissions = [];
    renderCard();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
