import { apiFetch, ClientApiError } from "./apiFetch";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("apiFetch", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    window.localStorage.clear();
  });

  it("returns data from a successful API payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { salesCount: 2 } }),
    );

    await expect(apiFetch("/api/dashboard/summary")).resolves.toEqual({
      salesCount: 2,
    });
  });

  it("serializes query params and JSON body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await apiFetch("/api/products", {
      body: { name: "Taladro" },
      method: "POST",
      query: { isActive: true, search: "taladro" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products?isActive=true&search=taladro",
      expect.objectContaining({
        body: JSON.stringify({ name: "Taladro" }),
        method: "POST",
      }),
    );
    const headers = fetchMock.mock.calls[0][1].headers as {
      get?: (key: string) => string | null;
      "content-type"?: string;
    };
    const contentType =
      typeof headers.get === "function"
        ? headers.get("content-type")
        : headers["content-type"];

    expect(contentType).toBe("application/json");
  });

  it("adds demo auth headers from local storage in the browser", async () => {
    process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH = "true";
    window.localStorage.setItem("control-ventas:user-role", "contador");
    window.localStorage.setItem("control-ventas:user-id", "user-accountant");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await apiFetch("/api/settings");

    const headers = fetchMock.mock.calls[0][1].headers as Headers;

    expect(headers.get("x-demo-role")).toBe("contador");
    expect(headers.get("x-demo-user-id")).toBe("user-accountant");
  });

  it("skips demo auth headers when demo auth is disabled", async () => {
    delete process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH;
    window.localStorage.setItem("control-ventas:user-role", "contador");
    window.localStorage.setItem("control-ventas:user-id", "user-accountant");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await apiFetch("/api/settings");

    const headers = fetchMock.mock.calls[0][1].headers as Headers;

    expect(headers.get("x-demo-role")).toBeNull();
    expect(headers.get("x-demo-user-id")).toBeNull();
  });

  it("throws a typed API error from error payloads", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "FORBIDDEN",
            message: "No tienes permiso.",
          },
        },
        403,
      ),
    );

    await expect(apiFetch("/api/dashboard/summary")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "No tienes permiso.",
      status: 403,
    } satisfies Partial<ClientApiError>);
  });
});
