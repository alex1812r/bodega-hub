/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/dashboard/recent-sales", () => {
  it("returns recent sales", async () => {
    const response = await GET(new Request("http://localhost/api/dashboard/recent-sales"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toEqual(expect.objectContaining({ id: "sale-002" }));
  });
});
