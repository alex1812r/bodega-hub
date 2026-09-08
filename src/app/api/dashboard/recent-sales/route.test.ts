/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/dashboard/recent-sales", () => {
  it("returns recent sales, most recent first", async () => {
    const response = await GET(new Request("http://localhost/api/dashboard/recent-sales"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);

    // Ordenadas por fecha descendente. Se afirma el orden y no un id concreto
    // porque el fixture de ventas crece (por ejemplo con las ventas de demo de
    // nomina, que se fechan relativas a hoy).
    const dates = body.data.items.map((sale: { createdAt: string }) => sale.createdAt);

    expect(dates).toEqual([...dates].sort().reverse());
  });
});
