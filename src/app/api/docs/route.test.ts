/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/docs", () => {
  it("redirects to visual API docs", () => {
    const response = GET(new Request("http://localhost/api/docs"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/api-docs");
  });
});
