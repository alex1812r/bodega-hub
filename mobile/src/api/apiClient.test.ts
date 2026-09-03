import { ApiClientError, createApiClient, NetworkError } from "./apiClient";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastRequestHeaders(mock: jest.Mock): Headers {
  const init = mock.mock.calls.at(-1)?.[1] as RequestInit;
  return init.headers as Headers;
}

describe("createApiClient", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.EXPO_PUBLIC_API_BASE_URL = "http://10.0.2.2:3000";
    process.env.EXPO_PUBLIC_ALLOW_DEMO_AUTH = "false";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("unwraps the data envelope the BFF uses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { role: "vendedor" } }));

    const api = createApiClient();

    await expect(api("/api/auth/me")).resolves.toEqual({ role: "vendedor" });
  });

  it("sends the access token as a Bearer header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    const api = createApiClient({ getAccessToken: () => "token-abc" });
    await api("/api/auth/me");

    expect(lastRequestHeaders(fetchMock).get("authorization")).toBe("Bearer token-abc");
  });

  it("omits demo headers unless demo auth is enabled", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    const api = createApiClient({ getDemoAuth: () => ({ role: "admin" }) });
    await api("/api/auth/me");

    expect(lastRequestHeaders(fetchMock).get("x-demo-role")).toBeNull();

    process.env.EXPO_PUBLIC_ALLOW_DEMO_AUTH = "true";
    await api("/api/auth/me");

    expect(lastRequestHeaders(fetchMock).get("x-demo-role")).toBe("admin");
  });

  it("builds the query string and drops empty values", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    const api = createApiClient();
    await api("/api/products", { query: { page: 1, search: "", status: undefined, q: "arroz" } });

    const url = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toBe("http://10.0.2.2:3000/api/products?page=1&q=arroz");
  });

  it("maps the BFF error payload onto ApiClientError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403),
    );

    const api = createApiClient();

    await expect(api("/api/vault")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "No tienes permiso.",
    });
  });

  it("notifies once on 401 so the session can be cleared", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "UNAUTHORIZED", message: "Debes iniciar sesion." } }, 401),
    );
    const onUnauthorized = jest.fn();

    const api = createApiClient({ onUnauthorized });

    await expect(api("/api/auth/me")).rejects.toBeInstanceOf(ApiClientError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("retries a GET once when the network fails", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    const api = createApiClient();

    await expect(api("/api/products")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a POST, because creating a sale is not idempotent", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    const api = createApiClient();

    await expect(
      api("/api/sales", { method: "POST", body: { items: [] } }),
    ).rejects.toBeInstanceOf(NetworkError);
    // Un solo intento: reintentar podria registrar la venta dos veces.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells the user to verify before retrying a failed write", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    const api = createApiClient();

    await expect(api("/api/sales", { method: "POST", body: {} })).rejects.toThrow(
      /verifica antes de reintentar/i,
    );
  });

  it("serialises an object body as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    const api = createApiClient();
    await api("/api/sales", { method: "POST", body: { total: 10 } });

    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(init.body).toBe('{"total":10}');
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });
});
