/**
 * @jest-environment node
 */

import { GET, PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/contacts/[id]", () => {
  it("returns contact details", async () => {
    const response = await GET(new Request("http://localhost/api/contacts/cont-customer"), context("cont-customer"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(expect.objectContaining({ id: "cont-customer", type: "cliente" }));
  });

  it("updates a contact with contacts.manage permission", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/contacts/cont-customer-alt", {
        body: JSON.stringify({ phone: "+58 414-0000000" }),
        headers: {
          "content-type": "application/json",
          "x-demo-user-id": "55555555-5555-4555-8555-555555555555",
        },
        method: "PATCH",
      }),
      context("cont-customer-alt"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(expect.objectContaining({ id: "cont-customer-alt", phone: "+58 414-0000000" }));
  });

  it("blocks updates without contacts.manage permission", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/contacts/cont-customer-alt", {
        body: JSON.stringify({ phone: "+58 414-1111111" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "PATCH",
      }),
      context("cont-customer-alt"),
    );

    expect(response.status).toBe(403);
  });
});
