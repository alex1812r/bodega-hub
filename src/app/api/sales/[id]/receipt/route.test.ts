/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/sales/[id]/receipt", () => {
  it("returns receipt payload", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales/sale-001/receipt", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("sale-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.invoiceNumber).toBe("V-000001");
  });
});
