/**
 * REP-09a · bug heredado: el rol almacén recibía 403 de
 * `/api/reports/payment-methods` porque la tarjeta lo pedía sin mirar permisos.
 * La ruta exige `reports.view`: sin él la tarjeta ni pide ni se monta.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

import { rolePermissions, type UserRole } from "@/shared/auth/permissions";

let mockRole: UserRole = "admin";
let mockIsLoading = false;

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) =>
      (jest.requireActual("../../../shared/auth/permissions").rolePermissions[mockRole] as string[]).includes(
        permission,
      ),
    isLoading: mockIsLoading,
    role: mockRole,
  }),
}));

import { DashboardPaymentMethodsCard } from "./DashboardPaymentMethodsCard";

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

describe("DashboardPaymentMethodsCard", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    mockRole = "admin";
    mockIsLoading = false;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          items: [{ amountRef: 12, amountVes: 6000, method: "pago_movil", paymentCount: 3 }],
          summary: { paymentCount: 3, totalRef: 12, totalVes: 6000 },
        },
      }),
    );
    global.fetch = fetchMock;
  });

  function renderCard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <DashboardPaymentMethodsCard from="2026-05-18" periodLabel="Hoy" to="2026-05-18" />
      </QueryClientProvider>,
    );
  }

  it.each(["almacen", "vendedor"] as const)(
    "%s no tiene reports.view: ni pide el reporte ni pinta la tarjeta",
    async (role) => {
      expect(rolePermissions[role]).not.toContain("reports.view");
      mockRole = role;

      const { container } = renderCard();

      // Deja pasar el ciclo en el que React Query lanzaría la consulta.
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("mientras no se conocen los permisos no pide nada", async () => {
    mockIsLoading = true;

    const { container } = renderCard();

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["admin", "contador"] as const)("%s pide el mix de pagos del periodo", async (role) => {
    mockRole = role;
    renderCard();

    expect(await screen.findByText("Mix de pagos")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/reports/payment-methods?from=2026-05-18&to=2026-05-18",
    );
    expect(await screen.findByText(/3 pagos/)).toBeInTheDocument();
  });
});
