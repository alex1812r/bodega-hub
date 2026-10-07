import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";

import { ThemeProvider } from "./ThemeProvider";
import { getStoredTheme, storeTheme, themeStorageKey } from "./theme";
import { useTheme } from "./useTheme";

function Probe() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button onClick={toggleTheme} type="button">
      {theme}
    </button>
  );
}

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

describe("tema con localStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("almacenamiento disponible", () => {
    it("lee el tema guardado y cae a claro con un valor desconocido", () => {
      expect(getStoredTheme()).toBe("light");

      window.localStorage.setItem(themeStorageKey, "dark");
      expect(getStoredTheme()).toBe("dark");

      window.localStorage.setItem(themeStorageKey, "sepia");
      expect(getStoredTheme()).toBe("light");
    });

    it("el proveedor arranca con el tema guardado, lo aplica y guarda los cambios", () => {
      window.localStorage.setItem(themeStorageKey, "dark");

      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );

      expect(screen.getByRole("button")).toHaveTextContent("dark");
      expect(document.documentElement).toHaveClass("dark");

      act(() => screen.getByRole("button").click());

      expect(screen.getByRole("button")).toHaveTextContent("light");
      expect(document.documentElement).toHaveClass("light");
      expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
    });
  });

  describe("almacenamiento bloqueado o lleno", () => {
    it("getStoredTheme devuelve claro si el getter de localStorage lanza", () => {
      blockLocalStorageGetter();

      expect(getStoredTheme()).toBe("light");
    });

    it("getStoredTheme devuelve claro si getItem lanza", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw securityError();
      });

      expect(getStoredTheme()).toBe("light");
    });

    it("storeTheme no lanza si setItem lanza por cuota o si el getter lanza", () => {
      const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError();
      });

      expect(() => storeTheme("dark")).not.toThrow();
      expect(setItem).toHaveBeenCalledWith(themeStorageKey, "dark");

      blockLocalStorageGetter();

      expect(() => storeTheme("dark")).not.toThrow();
    });

    it.each([
      ["el getter lanza SecurityError", blockLocalStorageGetter],
      [
        "getItem y setItem lanzan SecurityError",
        () => {
          jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw securityError();
          });
          jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw securityError();
          });
        },
      ],
      [
        "setItem lanza QuotaExceededError",
        () => {
          jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw quotaError();
          });
        },
      ],
    ])("el proveedor monta en claro y permite cambiar de tema cuando %s", (_label, breakStorage) => {
      breakStorage();

      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );

      expect(screen.getByRole("button")).toHaveTextContent("light");
      expect(document.documentElement).toHaveClass("light");

      act(() => screen.getByRole("button").click());

      expect(screen.getByRole("button")).toHaveTextContent("dark");
      expect(document.documentElement).toHaveClass("dark");
    });
  });
});
