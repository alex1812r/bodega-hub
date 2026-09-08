import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { PayrollSettingsPage } from "./page";

// El alias @/ lo reescribe SWC en los imports, no dentro de jest.mock.
jest.mock("../hooks/usePayroll", () => ({
  usePayrollPeriods: jest.fn(),
  usePayrollSettings: jest.fn(),
  useUpdatePayrollEmployee: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdatePayrollSettings: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

import { usePayrollPeriods, usePayrollSettings } from "../hooks/usePayroll";

const mockedUsePayrollPeriods = usePayrollPeriods as jest.MockedFunction<
  typeof usePayrollPeriods
>;
const mockedUsePayrollSettings = usePayrollSettings as jest.MockedFunction<
  typeof usePayrollSettings
>;

function buildPeriod(id: string, periodKey: string, grossProfitRef: number | null) {
  return {
    approvedAt: null,
    approvedBy: null,
    commissionRef: 100,
    createdAt: "2026-09-16T12:00:00.000Z",
    fromDate: "2026-09-01",
    grossProfitRef,
    id,
    notes: null,
    paidAt: null,
    periodKey,
    reversalRef: 0,
    salesRef: 3000,
    shareOfGrossProfitPct: null,
    status: "pagado" as const,
    storeId: "store-1",
    toDate: "2026-09-15",
    totalRef: 100,
    updatedAt: "2026-09-16T12:00:00.000Z",
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<PayrollSettingsPage />, { wrapper: Wrapper });
}

describe("PayrollSettingsPage — simulador", () => {
  beforeEach(() => {
    mockedUsePayrollSettings.mockReturnValue({
      data: {
        employees: [],
        settings: {
          defaultCommissionPct: 3,
          eligibleRoles: ["vendedor"],
          reinvestPct: 45,
          reservePct: 20,
          storeId: "store-1",
          updatedAt: "2026-09-16T12:00:00.000Z",
          warnShareOfGrossProfitPct: 40,
        },
      },
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof usePayrollSettings>);

    // Promedio de las tres ultimas quincenas con dato: (1000 + 2000 + 3000) / 3 = 2000.
    mockedUsePayrollPeriods.mockReturnValue({
      data: {
        items: [
          buildPeriod("period-1", "2026-09-Q1", 1000),
          buildPeriod("period-2", "2026-08-Q2", 2000),
          buildPeriod("period-3", "2026-08-Q1", 3000),
          buildPeriod("period-4", "2026-07-Q2", 9000),
        ],
        limit: 10,
        skip: 0,
        total: 4,
      },
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof usePayrollPeriods>);
  });

  it("traduce ventas y porcentaje a comision y a porcentaje de la ganancia bruta promedio", () => {
    renderPage();

    // 1000 REF al 3 % = 30 REF; 30 / 2000 = 1.5 % de la ganancia bruta promedio.
    const result = screen.getByTestId("payroll-simulator-result");

    expect(result).toHaveTextContent("Con ventas de ref 1000.00 al 3.00 %");
    expect(result).toHaveTextContent("la comision seria ref 30.00");
    expect(result).toHaveTextContent(
      "eso es 1.50 % de la ganancia bruta promedio de las ultimas 3 quincenas (ref 2000.00)",
    );
  });

  it("recalcula en vivo al cambiar el porcentaje", async () => {
    const user = userEvent.setup();
    renderPage();

    const pctInput = screen.getByLabelText("Comision (%)");

    await user.clear(pctInput);
    await user.type(pctInput, "10");

    // 1000 REF al 10 % = 100 REF; 100 / 2000 = 5 %.
    const result = screen.getByTestId("payroll-simulator-result");

    expect(result).toHaveTextContent("la comision seria ref 100.00");
    expect(result).toHaveTextContent("eso es 5.00 %");
  });
});
