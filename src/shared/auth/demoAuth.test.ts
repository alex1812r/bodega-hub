import {
  clearStoredDemoAuth,
  demoRoleStorageKey,
  demoStoreIdStorageKey,
  demoUserIdStorageKey,
  getStoredDemoRole,
  getStoredDemoStoreId,
  getStoredDemoUserId,
  setStoredDemoRole,
} from "./demoAuth";

function securityError() {
  return new DOMException("denied", "SecurityError");
}

function quotaError() {
  return new DOMException("quota", "QuotaExceededError");
}

/** Como un navegador con el almacenamiento bloqueado: leer `window.localStorage` ya lanza. */
function blockLocalStorageGetter() {
  jest.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw securityError();
  });
}

function blockLocalStorageMethods() {
  for (const method of ["getItem", "setItem", "removeItem"] as const) {
    jest.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw securityError();
    });
  }
}

describe("demoAuth con localStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("almacenamiento disponible", () => {
    it("lee el rol, el usuario y la tienda guardados", () => {
      expect(getStoredDemoRole()).toBeNull();
      expect(getStoredDemoUserId()).toBeNull();
      expect(getStoredDemoStoreId()).toBeNull();

      window.localStorage.setItem(demoRoleStorageKey, "admin");
      window.localStorage.setItem(demoUserIdStorageKey, "user-1");
      window.localStorage.setItem(demoStoreIdStorageKey, "store-1");

      expect(getStoredDemoRole()).toBe("admin");
      expect(getStoredDemoUserId()).toBe("user-1");
      expect(getStoredDemoStoreId()).toBe("store-1");
    });

    it("ignora un rol desconocido", () => {
      window.localStorage.setItem(demoRoleStorageKey, "superjefe");

      expect(getStoredDemoRole()).toBeNull();
    });

    it("setStoredDemoRole guarda el rol y avisa con un evento storage", () => {
      const onStorage = jest.fn();
      window.addEventListener("storage", onStorage);

      setStoredDemoRole("admin");

      window.removeEventListener("storage", onStorage);

      expect(window.localStorage.getItem(demoRoleStorageKey)).toBe("admin");
      expect(onStorage).toHaveBeenCalledTimes(1);
      expect(onStorage.mock.calls[0][0]).toMatchObject({
        key: demoRoleStorageKey,
        newValue: "admin",
      });
    });

    it("clearStoredDemoAuth borra las tres claves", () => {
      window.localStorage.setItem(demoRoleStorageKey, "admin");
      window.localStorage.setItem(demoUserIdStorageKey, "user-1");
      window.localStorage.setItem(demoStoreIdStorageKey, "store-1");

      clearStoredDemoAuth();

      expect(window.localStorage.getItem(demoRoleStorageKey)).toBeNull();
      expect(window.localStorage.getItem(demoUserIdStorageKey)).toBeNull();
      expect(window.localStorage.getItem(demoStoreIdStorageKey)).toBeNull();
    });
  });

  describe.each([
    ["el getter de localStorage lanza SecurityError", blockLocalStorageGetter],
    ["getItem, setItem y removeItem lanzan SecurityError", blockLocalStorageMethods],
  ])("almacenamiento bloqueado: %s", (_label, breakStorage) => {
    beforeEach(() => {
      breakStorage();
    });

    it("leer devuelve que no hay sesion demo guardada", () => {
      expect(getStoredDemoRole()).toBeNull();
      expect(getStoredDemoUserId()).toBeNull();
      expect(getStoredDemoStoreId()).toBeNull();
    });

    it("setStoredDemoRole no lanza ni anuncia un cambio que no se guardo", () => {
      const onStorage = jest.fn();
      window.addEventListener("storage", onStorage);

      expect(() => setStoredDemoRole("admin")).not.toThrow();

      window.removeEventListener("storage", onStorage);

      expect(onStorage).not.toHaveBeenCalled();
    });

    it("clearStoredDemoAuth no lanza", () => {
      expect(() => clearStoredDemoAuth()).not.toThrow();
    });
  });

  it("setStoredDemoRole no lanza si setItem lanza por cuota llena", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError();
    });

    expect(() => setStoredDemoRole("admin")).not.toThrow();
    expect(setItem).toHaveBeenCalledWith(demoRoleStorageKey, "admin");
  });
});
