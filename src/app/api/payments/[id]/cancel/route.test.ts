/**
 * @jest-environment node
 */

import { resolveDataSource } from "@/lib/api/dataSource";

jest.mock("../../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(),
}));

jest.mock("../../../../../modules/payments/services/payments.mock-server", () => ({
  cancelPayment: jest.fn(),
}));

jest.mock("../../../../../modules/payments/services/payments.server", () => ({
  cancelPayment: jest.fn(),
}));

jest.mock("../../../../../lib/api/requirePermission", () => ({
  requirePermission: jest.fn().mockResolvedValue(undefined),
}));

const { cancelPayment: cancelPaymentMock } = jest.requireMock<{
  cancelPayment: jest.Mock;
}>("../../../../../modules/payments/services/payments.mock-server");

describe("/api/payments/[id]/cancel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
    cancelPaymentMock.mockResolvedValue({
      id: "pay-001",
      status: "anulado",
    });
  });

  it("cancels a payment in mock mode", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://localhost/api/payments/pay-001/cancel", {
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "pay-001" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("anulado");
    expect(cancelPaymentMock).toHaveBeenCalledWith("pay-001");
  });
});
