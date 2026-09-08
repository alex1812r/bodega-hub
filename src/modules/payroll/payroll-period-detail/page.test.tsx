import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import type { PayrollPeriodDetail } from "../types";

import { PayrollPeriodDetailPage } from "./page";

// El alias @/ lo reescribe SWC en los imports, no dentro de jest.mock.
jest.mock("../hooks/usePayroll", () => ({
  useApprovePayrollPeriod: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useCancelPayrollPayment: () => ({ isPending: false, mutateAsync: jest.fn() }),
  usePayPayrollItem: () => ({ isPending: false, mutateAsync: jest.fn(), reset: jest.fn() }),
  usePayrollPeriod: jest.fn(),
  useRecomputePayrollPeriod: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));
jest.mock("../../settings/hooks/useSettings", () => ({
  useEnabledPaymentMethods: () => ({ data: undefined }),
  useSettings: () => ({ data: { businessName: "Bodega Demo" } }),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 500 } }),
}));
jest.mock("../../vault/hooks/useVault", () => ({
  useVault: () => ({
    data: { balanceEfectivoVes: 100000, balanceRef: 500, balanceVes: 20000 },
    isLoading: false,
  }),
  vaultKeys: { all: ["vault"], movements: ["vault", "movements"] },
}));
// Con factory: jspdf nunca se carga y jsdom no necesita TextEncoder.
jest.mock("../payroll-receipt/services/exportPayrollReceiptPdf", () => ({
  exportPayrollReceiptPdf: jest.fn(),
}));
jest.mock("../../auth/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: { permissions: ["payroll.manage"], role: "admin" },
    isLoading: false,
  }),
}));

import { usePayrollPeriod } from "../hooks/usePayroll";

const mockedUsePayrollPeriod = usePayrollPeriod as jest.MockedFunction<typeof usePayrollPeriod>;

const detail: PayrollPeriodDetail = {
  breakdown: null,
  items: [
    {
      commissionPct: 3,
      commissionRef: 45.6,
      employeeId: "employee-1",
      fullName: "Maria Perez",
      id: "item-1",
      paidAmount: null,
      paidAt: null,
      paidBy: null,
      paidCurrency: null,
      paidMethod: null,
      paidRateVes: null,
      paidRef: null,
      paidReference: null,
      paidVes: null,
      periodId: "period-1",
      profileId: "profile-1",
      reversalRef: -5.4,
      salesCount: 24,
      salesRef: 1520,
      status: "pendiente",
      storeId: "store-1",
      totalRef: 40.2,
      vaultMovementId: null,
    },
  ],
  period: {
    approvedAt: null,
    approvedBy: null,
    commissionRef: 180,
    createdAt: "2026-09-16T12:00:00.000Z",
    fromDate: "2026-09-01",
    grossProfitRef: 1200,
    id: "period-1",
    notes: null,
    paidAt: null,
    periodKey: "2026-09-Q1",
    reversalRef: -20,
    salesRef: 6000,
    shareOfGrossProfitPct: 15,
    status: "borrador",
    storeId: "store-1",
    toDate: "2026-09-15",
    totalRef: 160,
    updatedAt: "2026-09-16T12:00:00.000Z",
  },
  salesByItem: {
    "item-1": [
      {
        commissionRef: 3,
        createdAt: "2026-09-05T12:00:00.000Z",
        id: "commission-1",
        invoiceNumber: "F-001",
        kind: "normal",
        saleCreatedAt: "2026-09-05T12:00:00.000Z",
        saleId: "sale-1",
        saleTotalRef: 100,
      },
      {
        commissionRef: 6,
        createdAt: "2026-09-06T12:00:00.000Z",
        id: "commission-2",
        invoiceNumber: "F-002",
        kind: "late",
        saleCreatedAt: "2026-08-28T12:00:00.000Z",
        saleId: "sale-2",
        saleTotalRef: 200,
      },
      {
        commissionRef: -1.5,
        createdAt: "2026-09-07T12:00:00.000Z",
        id: "commission-3",
        invoiceNumber: "F-003",
        kind: "reversal",
        saleCreatedAt: "2026-08-20T12:00:00.000Z",
        saleId: "sale-3",
        saleTotalRef: 50,
      },
    ],
  },
  salesWithoutCashier: 0,
  settings: {
    defaultCommissionPct: 3,
    eligibleRoles: ["vendedor"],
    reinvestPct: 45,
    reservePct: 20,
    storeId: "store-1",
    updatedAt: "2026-09-16T12:00:00.000Z",
    warnShareOfGrossProfitPct: 40,
  },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<PayrollPeriodDetailPage periodId="period-1" />, { wrapper: Wrapper });
}

describe("PayrollPeriodDetailPage", () => {
  beforeEach(() => {
    mockedUsePayrollPeriod.mockReturnValue({
      data: detail,
      error: null,
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof usePayrollPeriod>);
  });

  it("muestra ventas comisionables, comision, reversos y total de la quincena", () => {
    renderPage();

    expect(screen.getByText("ref 6000.00")).toBeInTheDocument();
    expect(screen.getByText("ref 180.00")).toBeInTheDocument();
    expect(screen.getByText("ref -20.00")).toBeInTheDocument();
    expect(screen.getByText("ref 160.00")).toBeInTheDocument();
  });

  it("calcula el semaforo y el desglose del dueno con payrollMath", () => {
    renderPage();

    // 180 / 1200 = 15 %, por debajo del 25 % => verde.
    expect(screen.getByTestId("payroll-share-pct")).toHaveTextContent("15.00 %");
    expect(screen.getByText("Saludable")).toBeInTheDocument();
    // 1200 - 180 = 1020; 45 % = 459; 20 % = 204; libre = 357.
    expect(screen.getByText("ref 1020.00")).toBeInTheDocument();
    expect(screen.getByText("ref 459.00")).toBeInTheDocument();
    expect(screen.getByText("ref 204.00")).toBeInTheDocument();
    expect(screen.getByText("ref 357.00")).toBeInTheDocument();
  });

  it("etiqueta las ventas cobradas tarde y los reversos en el detalle", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Acciones de Maria Perez" }));
    await user.click(screen.getByRole("menuitem", { name: "Ver ventas" }));

    expect(screen.getByText("cobrada tarde")).toBeInTheDocument();
    expect(screen.getByText("reverso")).toBeInTheDocument();
    // La venta normal no lleva etiqueta.
    expect(screen.queryByText("de la quincena")).not.toBeInTheDocument();
  });
});
