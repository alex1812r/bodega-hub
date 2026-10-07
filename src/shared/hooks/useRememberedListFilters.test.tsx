import "@testing-library/jest-dom";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { z } from "zod";

import { RememberedFiltersChip } from "@/shared/components/RememberedFiltersChip";

import {
  REMEMBERED_FILTERS_STORAGE_PREFIX,
  REMEMBER_FILTERS_PREFERENCE_KEY,
  setRememberFiltersPreference,
  useRememberFiltersPreference,
  useRememberedListFilters,
} from "./useRememberedListFilters";
import { listParams, useUrlListState } from "./useUrlListState";

const mockReplace = jest.fn();
/** URL simulada: `router.replace` la actualiza como haría Next. */
const mockUrl = { pathname: "/products", query: "" };

jest.mock("next/navigation", () => ({
  usePathname: () => mockUrl.pathname,
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockUrl.query),
}));

const schema = z.object({
  search: listParams.text(),
  status: listParams.oneOf(["all", "active", "inactive"], "all"),
  tags: listParams.manyOf(["a", "b", "c"]),
  sort: listParams.sort(["name", "price"], "name"),
  page: listParams.page(),
  limit: listParams.limit(),
});

const STORAGE_KEY = `${REMEMBERED_FILTERS_STORAGE_PREFIX}products`;

function remember(filters: Record<string, unknown>) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

function remembered(): unknown {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);

  return raw === null ? null : JSON.parse(raw);
}

function useList() {
  const list = useUrlListState(schema);

  return { list, remembered: useRememberedListFilters("products", list) };
}

/** Entra a la lista con la query indicada (vacía = por el menú). */
function enterList(query = "") {
  mockUrl.query = query;

  return renderHook(() => useList());
}

function ListScreen() {
  const { list, remembered: filters } = useList();

  return (
    <div>
      <p data-testid="status">{list.state.status}</p>
      <button onClick={() => list.setField("status", "inactive")} type="button">
        Inactivos
      </button>
      {filters.restored ? <RememberedFiltersChip onClear={filters.clear} /> : null}
    </div>
  );
}

function blockStorage() {
  for (const method of ["getItem", "setItem", "removeItem"] as const) {
    jest.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  mockUrl.pathname = "/products";
  mockUrl.query = "";
  mockReplace.mockImplementation((url: string) => {
    mockUrl.query = url.split("?")[1] ?? "";
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useRememberedListFilters", () => {
  describe("guardado", () => {
    it("guarda los filtros que difieren de su default al cambiarlos", () => {
      const { result } = enterList();

      expect(remembered()).toBeNull();

      act(() => result.current.list.setState({ status: "active", tags: ["a", "c"] }));

      expect(remembered()).toEqual({ status: "active", tags: ["a", "c"] });
      expect(result.current.remembered.restored).toBe(false);
    });

    it("guarda también los filtros con los que se entra por URL", () => {
      enterList("status=inactive&sort=price");

      expect(remembered()).toEqual({ sort: "price", status: "inactive" });
    });

    it("olvida lo guardado cuando la lista vuelve a sus defaults", () => {
      const { result } = enterList("status=active");

      act(() => result.current.list.setField("status", "all"));

      expect(remembered()).toBeNull();
    });

    it("no guarda la página", () => {
      const { result } = enterList("status=active");

      act(() => result.current.list.setField("page", 7));

      expect(result.current.list.state.page).toBe(7);
      expect(remembered()).toEqual({ status: "active" });
    });

    it("una lista solo paginada no deja nada guardado", () => {
      enterList("page=4");

      expect(remembered()).toBeNull();
    });
  });

  describe("restauración", () => {
    it("sin parámetros en la URL restaura los últimos filtros", () => {
      remember({ limit: 25, sort: "price", status: "active", tags: ["b"] });

      const { result } = enterList();

      expect(result.current.list.state).toMatchObject({
        limit: 25,
        sort: "price",
        status: "active",
        tags: ["b"],
      });
      expect(result.current.remembered.restored).toBe(true);
      expect(new URLSearchParams(mockUrl.query).get("status")).toBe("active");
      expect(new URLSearchParams(mockUrl.query).get("limit")).toBe("25");
      expect(remembered()).toEqual({ limit: 25, sort: "price", status: "active", tags: ["b"] });
    });

    it("siempre restaura en la primera página, aunque lo guardado traiga otra", () => {
      remember({ page: 9, status: "active" });

      const { result } = enterList();

      expect(result.current.list.state.status).toBe("active");
      expect(result.current.list.state.page).toBe(1);
      expect(mockUrl.query).toBe("status=active");
    });

    it("con parámetros en la URL manda la URL y no restaura nada", () => {
      remember({ sort: "price", status: "active" });

      const { result } = enterList("status=inactive");

      expect(result.current.list.state.status).toBe("inactive");
      expect(result.current.list.state.sort).toBe("name");
      expect(result.current.remembered.restored).toBe(false);
    });

    it("un parámetro ajeno al schema también cuenta como URL con parámetros", () => {
      remember({ status: "active" });

      const { result } = enterList("tab=resumen");

      expect(result.current.list.state.status).toBe("all");
      expect(result.current.remembered.restored).toBe(false);
    });

    it("sin nada guardado no restaura ni marca el chip", () => {
      const { result } = enterList();

      expect(result.current.list.isDefault).toBe(true);
      expect(result.current.remembered.restored).toBe(false);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it.each([
      ["valor que el schema rechaza", JSON.stringify({ status: "borrados" })],
      ["JSON corrupto", "{no-es-json"],
      ["una lista en vez de un objeto", JSON.stringify(["status"])],
      ["solo campos desconocidos", JSON.stringify({ hack: "x" })],
    ])("ignora lo guardado con %s", (_label, raw) => {
      window.sessionStorage.setItem(STORAGE_KEY, raw);

      const { result } = enterList();

      expect(result.current.list.isDefault).toBe(true);
      expect(result.current.remembered.restored).toBe(false);
    });

    it("cada lista recuerda lo suyo", () => {
      window.sessionStorage.setItem(
        `${REMEMBERED_FILTERS_STORAGE_PREFIX}sales`,
        JSON.stringify({ status: "active" }),
      );

      const { result } = enterList();

      expect(result.current.list.isDefault).toBe(true);
    });

    it("restaura una sola vez también en StrictMode", () => {
      remember({ status: "active" });
      mockUrl.query = "";

      const { result } = renderHook(() => useList(), { wrapper: StrictMode });

      expect(result.current.list.state.status).toBe("active");
      expect(result.current.remembered.restored).toBe(true);
      expect(remembered()).toEqual({ status: "active" });
    });

    it("el chip sigue al cambiar un filtro y desaparece si la lista queda en sus defaults", () => {
      remember({ status: "active" });

      const { result } = enterList();

      act(() => result.current.list.setField("sort", "price"));
      expect(result.current.remembered.restored).toBe(true);

      act(() => result.current.list.setState({ sort: "name", status: "all" }));
      expect(result.current.remembered.restored).toBe(false);
    });

    it("con lo guardado inservible, el primer filtro manual no muestra el chip (SHR-17)", () => {
      remember({ status: "borrados" });

      const { result } = enterList();

      act(() => result.current.list.setField("status", "active"));

      expect(result.current.list.state.status).toBe("active");
      expect(result.current.remembered.restored).toBe(false);
    });

    it("con lo guardado igual a los defaults, el primer filtro manual no muestra el chip (SHR-17)", () => {
      remember({ status: "all" });

      const { result } = enterList();

      act(() => result.current.list.setField("status", "active"));

      expect(result.current.remembered.restored).toBe(false);
    });

    it("tras un reset manual de la lista restaurada, un filtro nuevo no vuelve a mostrar el chip (SHR-17)", () => {
      remember({ status: "active" });

      const { result } = enterList();

      expect(result.current.remembered.restored).toBe(true);

      act(() => result.current.list.reset());
      act(() => result.current.list.setField("status", "inactive"));

      expect(result.current.list.state.status).toBe("inactive");
      expect(result.current.remembered.restored).toBe(false);
    });
  });

  describe("Limpiar", () => {
    it("el chip aparece al restaurar y Limpiar hace reset y olvida lo guardado", async () => {
      const user = userEvent.setup();
      remember({ status: "active" });
      mockUrl.query = "";

      render(<ListScreen />);

      expect(screen.getByTestId("status")).toHaveTextContent("active");
      expect(screen.getByRole("status")).toHaveTextContent("Filtros recordados · Limpiar");

      await user.click(screen.getByRole("button", { name: "Limpiar" }));

      expect(screen.getByTestId("status")).toHaveTextContent("all");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(remembered()).toBeNull();
      expect(mockUrl.query).toBe("");
    });

    it("tras Limpiar, un filtro nuevo se guarda pero no vuelve a mostrar el chip", async () => {
      const user = userEvent.setup();
      remember({ status: "active" });
      mockUrl.query = "";

      render(<ListScreen />);

      await user.click(screen.getByRole("button", { name: "Limpiar" }));
      await user.click(screen.getByRole("button", { name: "Inactivos" }));

      expect(screen.getByTestId("status")).toHaveTextContent("inactive");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(remembered()).toEqual({ status: "inactive" });
    });
  });

  describe("preferencia Recordar filtros", () => {
    it("está activa por defecto", () => {
      const { result } = renderHook(() => useRememberFiltersPreference());

      expect(result.current[0]).toBe(true);
    });

    it("desactivada: no restaura ni guarda", () => {
      window.localStorage.setItem(REMEMBER_FILTERS_PREFERENCE_KEY, "0");
      remember({ status: "active" });

      const { result } = enterList();

      expect(result.current.list.isDefault).toBe(true);
      expect(result.current.remembered.restored).toBe(false);
      expect(result.current.remembered.enabled).toBe(false);

      act(() => result.current.list.setField("sort", "price"));

      expect(remembered()).toEqual({ status: "active" });
    });

    describe("desactivada, en una carga completa (HTML del servidor + hidratación)", () => {
      /** Como F5 o una URL directa: el servidor no conoce la preferencia y pinta con el valor por defecto. */
      async function loadPage(query: string) {
        mockUrl.query = query;

        const container = document.createElement("div");

        document.body.appendChild(container);
        container.innerHTML = renderToString(<ListScreen />);

        const root = await act(async () => hydrateRoot(container, <ListScreen />));

        return {
          container,
          unload: async () => {
            await act(async () => root.unmount());
            container.remove();
          },
        };
      }

      it("no guarda los filtros con los que se carga la página", async () => {
        window.localStorage.setItem(REMEMBER_FILTERS_PREFERENCE_KEY, "0");

        const page = await loadPage("status=active");

        expect(page.container.querySelector('[data-testid="status"]')).toHaveTextContent("active");
        expect(remembered()).toBeNull();

        await page.unload();
      });

      it("no borra lo guardado al cargar la lista sin filtros", async () => {
        window.localStorage.setItem(REMEMBER_FILTERS_PREFERENCE_KEY, "0");
        remember({ status: "active" });

        const page = await loadPage("");

        expect(page.container.querySelector('[data-testid="status"]')).toHaveTextContent("all");
        expect(remembered()).toEqual({ status: "active" });

        await page.unload();
      });

      it("activada, la misma carga sí guarda", async () => {
        const page = await loadPage("status=active");

        expect(remembered()).toEqual({ status: "active" });

        await page.unload();
      });
    });

    it("se guarda en localStorage y al desactivarla se olvida lo recordado", () => {
      remember({ status: "active" });
      window.sessionStorage.setItem("otra-clave", "se-conserva");

      const { result } = renderHook(() => useRememberFiltersPreference());

      act(() => result.current[1](false));

      expect(result.current[0]).toBe(false);
      expect(window.localStorage.getItem(REMEMBER_FILTERS_PREFERENCE_KEY)).toBe("0");
      expect(remembered()).toBeNull();
      expect(window.sessionStorage.getItem("otra-clave")).toBe("se-conserva");

      act(() => setRememberFiltersPreference(true));

      expect(result.current[0]).toBe(true);
      expect(window.localStorage.getItem(REMEMBER_FILTERS_PREFERENCE_KEY)).toBe("1");
    });

    it("al desactivarla con una lista abierta desaparece el chip y no se tocan los filtros", () => {
      remember({ status: "active" });

      const { result } = enterList();

      expect(result.current.remembered.restored).toBe(true);

      act(() => setRememberFiltersPreference(false));

      expect(result.current.remembered.restored).toBe(false);
      expect(result.current.list.state.status).toBe("active");
    });
  });

  describe("storage bloqueado", () => {
    it("funciona sin recordar nada", () => {
      blockStorage();

      const { result } = enterList();

      expect(result.current.remembered.enabled).toBe(true);
      expect(result.current.remembered.restored).toBe(false);
      expect(() => act(() => result.current.list.setField("status", "active"))).not.toThrow();
      expect(result.current.list.state.status).toBe("active");
      expect(() => act(() => result.current.remembered.clear())).not.toThrow();
      expect(result.current.list.isDefault).toBe(true);
      expect(() => act(() => setRememberFiltersPreference(false))).not.toThrow();
    });
  });
});
