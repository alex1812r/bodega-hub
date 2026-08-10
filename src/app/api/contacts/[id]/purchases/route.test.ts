/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/contacts/[id]/purchases", () => {
  it("returns purchases for a contact", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-supplier/purchases"),
      context("cont-supplier"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });

  it("forbids vendedor from listing contact purchases", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-supplier/purchases", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("cont-supplier"),
    );

    expect(response.status).toBe(403);
  });
});
