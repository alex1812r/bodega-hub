import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { PurchaseDetailsPage } from "./page";

/** PRO-10 · el detalle de compra monta el aviso de reprecio con el id de la compra cargada. */

const purchase = {
  createdAt: "2026-10-07T12:00:00.000Z",
  discountRef: 0,
  id: "purchase-loaded",
  items: [],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-000123",
  refRateVes: 510,
  status: "recibido",
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 9,
  totalVes: 4590,
};

let purchaseQuery: { data?: typeof purchase; error: Error | null; isLoading: boolean };

const mutation = { error: null, isPending: false, mutateAsync: jest.fn() };

jest.mock("../hooks/usePurchases", () => ({
  useCancelPurchase: () => mutation,
  usePurchase: () => ({ ...purchaseQuery, refetch: jest.fn() }),
  useReceivePurchase: () => mutation,
  useReturnPurchase: () => mutation,
}));

jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 } }),
}));

jest.mock("../../products/components/price-review/PurchaseRepriceNotice", () => ({
  PurchaseRepriceNotice: ({ purchaseId }: { purchaseId: string }) => (
    <div data-purchase-id={purchaseId} data-testid="purchase-reprice-notice" />
  ),
}));

jest.mock("./services/exportPurchaseDetailPdf", () => ({ exportPurchaseDetailPdf: jest.fn() }));
jest.mock("./components/PurchaseDetailDatesCard", () => ({ PurchaseDetailDatesCard: () => null }));
jest.mock("./components/PurchaseDetailFinancialCard", () => ({ PurchaseDetailFinancialCard: () => null }));
jest.mock("./components/PurchaseDetailHeaderCard", () => ({ PurchaseDetailHeaderCard: () => null }));
jest.mock("./components/PurchaseDetailInfoBanner", () => ({ PurchaseDetailInfoBanner: () => null }));
jest.mock("./components/PurchaseDetailPageHeader", () => ({ PurchaseDetailPageHeader: () => null }));
jest.mock("./components/PurchaseDetailPaymentStatusCard", () => ({
  PurchaseDetailPaymentStatusCard: () => null,
}));
jest.mock("./components/PurchaseDetailPaymentsTable", () => ({ PurchaseDetailPaymentsTable: () => null }));
jest.mock("./components/PurchaseDetailProductsTable", () => ({ PurchaseDetailProductsTable: () => null }));
jest.mock("./components/PurchaseDetailSupplierCard", () => ({ PurchaseDetailSupplierCard: () => null }));

describe("PurchaseDetailsPage · aviso de reprecio (PRO-10)", () => {
  it("monta el aviso con el id de la compra", () => {
    purchaseQuery = { data: purchase, error: null, isLoading: false };
    render(<PurchaseDetailsPage purchaseId="purchase-loaded" />);

    expect(screen.getByTestId("purchase-reprice-notice")).toHaveAttribute(
      "data-purchase-id",
      "purchase-loaded",
    );
  });

  it("no lo monta mientras la compra carga ni si falla", () => {
    purchaseQuery = { data: undefined, error: null, isLoading: true };
    const { unmount } = render(<PurchaseDetailsPage purchaseId="purchase-loaded" />);

    expect(screen.queryByTestId("purchase-reprice-notice")).not.toBeInTheDocument();
    unmount();

    purchaseQuery = { data: undefined, error: new Error("boom"), isLoading: false };
    render(<PurchaseDetailsPage purchaseId="purchase-loaded" />);

    expect(screen.queryByTestId("purchase-reprice-notice")).not.toBeInTheDocument();
  });
});
