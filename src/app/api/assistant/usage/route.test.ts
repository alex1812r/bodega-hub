/**
 * @jest-environment node
 */

import { resetQueries } from "@/modules/assistant/server/usage.mock-server";

import { GET } from "./route";

function request(role: string) {
  return new Request("http://localhost/api/assistant/usage", {
    headers: { "x-demo-role": role },
  });
}

describe("/api/assistant/usage", () => {
  beforeEach(() => {
    resetQueries();
    delete process.env.ASSISTANT_DAILY_LIMIT;
  });

  it("returns the daily usage for an admin", async () => {
    const response = await GET(request("admin"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      limit: 100,
      resetsAt: expect.any(String),
      used: 0,
    });
  });

  it("returns the daily usage for a superadmin", async () => {
    const response = await GET(request("superadmin"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ used: 0 }),
    });
  });

  it("honours ASSISTANT_DAILY_LIMIT", async () => {
    process.env.ASSISTANT_DAILY_LIMIT = "7";
    const body = await (await GET(request("admin"))).json();

    expect(body.data.limit).toBe(7);
  });

  it("rejects roles without assistant.use", async () => {
    const response = await GET(request("vendedor"));

    expect(response.status).toBe(403);
  });
});
