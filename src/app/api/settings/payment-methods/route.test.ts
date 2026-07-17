/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");

import { GET } from "./route";

describe("/api/settings/payment-methods", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns enabled payment methods for store sellers", async () => {
    const response = await GET(
      new Request("http://localhost/api/settings/payment-methods", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.enabledPaymentMethods).toEqual([
      "efectivo_ves",
      "efectivo_usd",
      "pago_movil",
      "punto_venta",
      "transferencia",
    ]);
  });
});
