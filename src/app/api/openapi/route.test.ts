/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/openapi", () => {
  it("serves the OpenAPI YAML contract", async () => {
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/yaml");
    expect(body).toContain("openapi: 3.0.3");
  });
});
