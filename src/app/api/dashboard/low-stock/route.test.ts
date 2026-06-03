/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/dashboard/low-stock", () => {
  it("returns compact low-stock products", async () => {
    const response = await GET(new Request("http://localhost/api/dashboard/low-stock"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "prod-cable" })]),
    );
  });
});
