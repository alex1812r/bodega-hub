/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/contacts/[id]/sales", () => {
  it("returns sales for a contact", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-customer/sales"),
      context("cont-customer"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ customerId: "cont-customer" })]),
    );
  });
});
