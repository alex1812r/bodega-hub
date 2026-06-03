/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/contacts/[id]/activity", () => {
  it("returns contact activity", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/cont-customer/activity"),
      context("cont-customer"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ type: "sale" })]));
  });
});
