/** @jest-environment node */

import { GET } from "./route";

describe("GET /api/cron/cash-sessions/auto-close", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("returns 503 when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("http://localhost/api/cron/cash-sessions/auto-close"));
    expect(response.status).toBe(503);
  });

  it("rejects missing cron secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const response = await GET(new Request("http://localhost/api/cron/cash-sessions/auto-close"));
    expect(response.status).toBe(401);
  });

  it("closes stale sessions when authorized", async () => {
    process.env.CRON_SECRET = "test-cron-secret";

    const response = await GET(
      new Request("http://localhost/api/cron/cash-sessions/auto-close", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    const body = (await response.json()) as { data: { closedCount: number; sessionIds: string[] } };

    expect(response.status).toBe(200);
    expect(body.data.closedCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.data.sessionIds)).toBe(true);
  });
});
