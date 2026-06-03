/**
 * @jest-environment node
 */

import { GET, PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/payments/[id]", () => {
  it("returns payment details", async () => {
    const response = await GET(new Request("http://localhost/api/payments/pay-001"), context("pay-001"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(expect.objectContaining({ id: "pay-001" }));
  });

  it("returns not found for missing payment", async () => {
    const response = await GET(new Request("http://localhost/api/payments/missing"), context("missing"));

    expect(response.status).toBe(404);
  });

  it("updates payment notes with manage permission", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/payments/pay-001", {
        body: JSON.stringify({ notes: "Nota de seguimiento" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "PATCH",
      }),
      context("pay-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.notes).toBe("Nota de seguimiento");
  });
});
