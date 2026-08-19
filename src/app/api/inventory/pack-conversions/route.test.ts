/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory/pack-conversions", () => {
  it("lists pack conversions for warehouse role", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/pack-conversions", {
        headers: { "x-demo-role": "almacen" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
  });
});
