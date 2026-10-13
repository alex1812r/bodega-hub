import {
  buildLoginUrl,
  loginNavigation,
  redirectToLoginOnSessionExpired,
  resolveLoginNextPath,
} from "./loginRedirect";

describe("buildLoginUrl", () => {
  it("conserva la ruta y la query actuales en next", () => {
    expect(buildLoginUrl("/sales?status=pending&page=2")).toBe(
      "/login?next=%2Fsales%3Fstatus%3Dpending%26page%3D2",
    );
  });

  it.each([
    ["URL absoluta", "https://evil.example/phish"],
    ["protocolo relativo", "//evil.example"],
    ["barra invertida", "/\\evil.example"],
    ["barra invertida codificada", "/%5Cevil.example"],
    ["doble barra interna", "/sales//evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["segmentos ..", "/sales/../../etc"],
    ["carácter de control", "/sales\n/evil"],
    ["ruta del BFF", "/api/auth/me"],
    ["next anidado externo", "/sales?next=https://evil.example"],
    ["login recursivo", "/login"],
    ["login recursivo con query", "/login?next=%2Fsales"],
    ["subruta del login", "/login/reset"],
    ["vacío", ""],
    ["null", null],
    ["undefined", undefined],
  ])("descarta next cuando es %s", (_label, path) => {
    expect(buildLoginUrl(path)).toBe("/login");
  });
});

describe("resolveLoginNextPath", () => {
  it("usa next si es una ruta interna segura", () => {
    expect(resolveLoginNextPath("/purchases/create?draft=1", "/dashboard")).toBe(
      "/purchases/create?draft=1",
    );
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/login",
    "/login?next=/sales",
    null,
  ])("vuelve al inicio del rol con next = %p", (next) => {
    expect(resolveLoginNextPath(next, "/dashboard")).toBe("/dashboard");
  });
});

describe("redirectToLoginOnSessionExpired", () => {
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
  });

  it("navega una sola vez aunque se llame varias veces seguidas", () => {
    window.history.replaceState({}, "", "/sales/create?customer=7");

    expect(redirectToLoginOnSessionExpired()).toBe(true);
    expect(redirectToLoginOnSessionExpired()).toBe(false);
    expect(redirectToLoginOnSessionExpired()).toBe(false);

    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fsales%2Fcreate%3Fcustomer%3D7");
  });

  it("permite otra redirección si la navegación no llegó a ocurrir (aviso nativo cancelado)", () => {
    window.history.replaceState({}, "", "/sales/create");

    redirectToLoginOnSessionExpired();
    jest.advanceTimersByTime(5000);
    redirectToLoginOnSessionExpired();

    expect(assignSpy).toHaveBeenCalledTimes(2);
  });

  it.each(["/login", "/login?next=%2Fsales", "/api-docs", "/dev/welcome"])(
    "no redirige estando en %s",
    (path) => {
      window.history.replaceState({}, "", path);

      expect(redirectToLoginOnSessionExpired()).toBe(false);
      expect(assignSpy).not.toHaveBeenCalled();
    },
  );

  it("va a /login sin next si la URL actual no es un destino seguro", () => {
    window.history.replaceState({}, "", "/sales?returnTo=https%3A%2F%2Fevil.example");

    redirectToLoginOnSessionExpired();

    expect(assignSpy).toHaveBeenCalledWith("/login");
  });

  it("no borra los borradores guardados en el navegador", () => {
    window.localStorage.setItem("bodega-hub:draft-probe", "carrito");
    window.sessionStorage.setItem("bodega-hub:draft-probe", "compra");
    window.history.replaceState({}, "", "/sales/create");

    redirectToLoginOnSessionExpired();

    expect(window.localStorage.getItem("bodega-hub:draft-probe")).toBe("carrito");
    expect(window.sessionStorage.getItem("bodega-hub:draft-probe")).toBe("compra");
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});
