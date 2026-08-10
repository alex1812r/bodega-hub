/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/contacts/[id]/payments", () => {
  it("returns payments for a contact", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-customer/payments"),
      context("cont-customer"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ contactId: "cont-customer" })]),
    );
  });

  it("hides purchase payments from vendedor on customer contacts", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-customer/payments", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("cont-customer"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.every((payment: { purchaseId?: string }) => !payment.purchaseId)).toBe(
      true,
    );
  });

  it("forbids vendedor from reading payments of a supplier contact", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-supplier/payments", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("cont-supplier"),
    );

    expect(response.status).toBe(403);
  });
});
