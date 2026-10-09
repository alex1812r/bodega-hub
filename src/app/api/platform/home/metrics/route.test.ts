/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/metrics", () => {
  it("returns aggregated metrics for superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/metrics?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          salesCount: expect.any(Number),
          totalRef: expect.any(Number),
        }),
      }),
    );
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/metrics?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });

  // INT-05 (B3): el mismo validador de fechas que `/api/dashboard/metrics` (REP-F7).
  it.each([
    ["from=2026-05-01&to=9999-12-31", /"hasta" no es válida.*año/],
    ["from=1999-12-31&to=2026-05-18", /"desde" no es válida.*año/],
    ["from=abc&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2026-05-01&to=2026-05-18%0a", /"hasta" no es válida/],
  ])("400 en español con %s", async (query, message) => {
    const response = await GET(
      new Request(`http://localhost/api/platform/home/metrics?storeScope=all&${query}`, {
        headers: { "x-demo-role": "superadmin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
  });

  it.each(["from=2026-05-01&to=2026-05-18", "from=9999-12-31&fromStart=1&to=2026-05-18", "from=&to="])(
    "200 con «%s»",
    async (query) => {
      const response = await GET(
        new Request(`http://localhost/api/platform/home/metrics?storeScope=all&${query}`, {
          headers: { "x-demo-role": "superadmin" },
        }),
      );

      expect(response.status).toBe(200);
    },
  );
});
