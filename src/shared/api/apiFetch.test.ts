import { loginNavigation } from "@/shared/auth/loginRedirect";

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
    window.localStorage.setItem("bodega-hub:user-role", "contador");
    window.localStorage.setItem("bodega-hub:user-id", "user-accountant");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await apiFetch("/api/settings");

    const headers = fetchMock.mock.calls[0][1].headers as Headers;

    expect(headers.get("x-demo-role")).toBe("contador");
    expect(headers.get("x-demo-user-id")).toBe("user-accountant");
  });

  it("skips demo auth headers when demo auth is disabled", async () => {
    delete process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH;
    window.localStorage.setItem("bodega-hub:user-role", "contador");
    window.localStorage.setItem("bodega-hub:user-id", "user-accountant");
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

  it("exposes the details of the BFF error body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "CONFLICT",
            details: { retryable: true },
            message: "La operacion choco con otra en curso y no se aplico. Intenta de nuevo.",
          },
        },
        409,
      ),
    );

    const error = await apiFetch("/api/sales", { body: {}, method: "POST" }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ClientApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { retryable: true },
      status: 409,
    } satisfies Partial<ClientApiError>);
    expect((error as ClientApiError).issues).toBeUndefined();
  });

  it("keeps issues and leaves details undefined when the body has none", async () => {
    const issues = [{ message: "Required", path: ["clientRequestId"] }];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "BAD_REQUEST",
            issues,
            message: "La solicitud no tiene un formato valido.",
          },
        },
        400,
      ),
    );

    const error = await apiFetch("/api/sales", { body: {}, method: "POST" }).catch(
      (reason: unknown) => reason,
    );

    expect((error as ClientApiError).issues).toEqual(issues);
    expect((error as ClientApiError).details).toBeUndefined();
  });

  describe("POS-H3 · sesión caducada (401)", () => {
    const unauthorized = () =>
      jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Debes iniciar sesión para continuar." } },
        401,
      );
    let assignSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      assignSpy = jest.spyOn(loginNavigation, "assign").mockImplementation(() => undefined);
    });

    afterEach(() => {
      // Suelta el cerrojo de redirección para el siguiente test.
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      assignSpy.mockRestore();
      window.history.replaceState({}, "", "/");
      delete process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH;
    });

    it("redirects once to /login keeping the current path and query when several requests fail together", async () => {
      window.history.replaceState({}, "", "/sales/create?customer=7");
      fetchMock.mockImplementation(async () => unauthorized());

      const results = await Promise.allSettled([
        apiFetch("/api/products"),
        apiFetch("/api/cash-sessions/current"),
        apiFetch("/api/sales", { body: { lines: [] }, method: "POST" }),
        apiFetch("/api/auth/me"),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
        "rejected",
        "rejected",
      ]);
      expect(results[0]).toMatchObject({ reason: { code: "UNAUTHORIZED", status: 401 } });
      expect(assignSpy).toHaveBeenCalledTimes(1);
      expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fsales%2Fcreate%3Fcustomer%3D7");
    });

    it.each([
      ["a nested external returnTo", "/sales?returnTo=https%3A%2F%2Fevil.example"],
      ["a nested protocol-relative next", "/sales?next=%2F%2Fevil.example"],
      ["an encoded backslash path", "/%5Cevil.example"],
    ])("drops next when the current URL carries %s", async (_label, currentUrl) => {
      window.history.replaceState({}, "", currentUrl);
      fetchMock.mockResolvedValueOnce(unauthorized());

      await expect(apiFetch("/api/products")).rejects.toMatchObject({ status: 401 });

      expect(assignSpy).toHaveBeenCalledTimes(1);
      expect(assignSpy).toHaveBeenCalledWith("/login");
    });

    it("does not redirect when already on /login", async () => {
      window.history.replaceState({}, "", "/login?next=%2Fsales");
      fetchMock.mockResolvedValueOnce(unauthorized());

      await expect(apiFetch("/api/auth/me")).rejects.toMatchObject({ status: 401 });

      expect(assignSpy).not.toHaveBeenCalled();
    });

    it("does not redirect for the 401 of POST /api/auth/login (wrong credentials)", async () => {
      window.history.replaceState({}, "", "/sales");
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas." } }, 401),
      );

      await expect(
        apiFetch("/api/auth/login", { body: { email: "a@b.co", password: "x" }, method: "POST" }),
      ).rejects.toMatchObject({ message: "Credenciales invalidas.", status: 401 });

      expect(assignSpy).not.toHaveBeenCalled();
    });

    it("does not redirect for other errors (403, 500)", async () => {
      window.history.replaceState({}, "", "/sales");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ error: { code: "FORBIDDEN", message: "No." } }, 403))
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Ups." } }, 500),
        );

      await expect(apiFetch("/api/products")).rejects.toMatchObject({ status: 403 });
      await expect(apiFetch("/api/products")).rejects.toMatchObject({ status: 500 });

      expect(assignSpy).not.toHaveBeenCalled();
    });

    it("keeps demo mode working: successful demo requests never redirect", async () => {
      process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH = "true";
      window.localStorage.setItem("bodega-hub:user-role", "vendedor");
      window.history.replaceState({}, "", "/sales/create");
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

      await expect(apiFetch("/api/products")).resolves.toEqual({ ok: true });

      expect(assignSpy).not.toHaveBeenCalled();
    });
  });
});
