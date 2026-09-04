/**
 * @jest-environment node
 */

import { headers } from "next/headers";

import { getBearerToken } from "./bearer";

const mockedHeaders = headers as jest.MockedFunction<typeof headers>;

function withHeaders(init?: HeadersInit) {
  mockedHeaders.mockResolvedValue(new Headers(init) as unknown as Awaited<
    ReturnType<typeof headers>
  >);
}

describe("getBearerToken", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when there is no authorization header", async () => {
    withHeaders();

    await expect(getBearerToken()).resolves.toBeNull();
  });

  it("extracts the token from a Bearer header", async () => {
    withHeaders({ authorization: "Bearer access-token-123" });

    await expect(getBearerToken()).resolves.toBe("access-token-123");
  });

  it("accepts the scheme in any casing and trims the token", async () => {
    withHeaders({ authorization: "bearer   access-token-123  " });

    await expect(getBearerToken()).resolves.toBe("access-token-123");
  });

  it("ignores non-Bearer schemes", async () => {
    withHeaders({ authorization: "Basic dXNlcjpwYXNz" });

    await expect(getBearerToken()).resolves.toBeNull();
  });

  it("ignores an empty Bearer token", async () => {
    withHeaders({ authorization: "Bearer   " });

    await expect(getBearerToken()).resolves.toBeNull();
  });

  it("returns null outside of a request scope instead of throwing", async () => {
    mockedHeaders.mockRejectedValue(new Error("headers() outside request"));

    await expect(getBearerToken()).resolves.toBeNull();
  });
});
