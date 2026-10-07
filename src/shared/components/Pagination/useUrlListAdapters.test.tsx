import { act, renderHook } from "@testing-library/react";
import { z } from "zod";

import { listParams, useUrlListState } from "@/shared/hooks/useUrlListState";

import { usePaginationState, useSortState, useUrlPaginationState, useUrlSortState } from ".";

const mockReplace = jest.fn();
const mockUrl = { query: "" };

jest.mock("next/navigation", () => ({
  usePathname: () => "/productos",
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockUrl.query),
}));

const schema = z.object({
  status: listParams.oneOf(["all", "active"], "all"),
  sort: listParams.sort(["name", "price"], "name"),
  dir: listParams.dir(),
  page: listParams.page(),
  limit: listParams.limit(),
});

function renderAdapters(query = "") {
  mockUrl.query = query;

  return renderHook(() => {
    const list = useUrlListState(schema);

    return { list, pagination: useUrlPaginationState(list), sort: useUrlSortState(list) };
  });
}

function lastReplacedUrl(): string {
  return mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.query = "";
  mockReplace.mockImplementation((url: string) => {
    mockUrl.query = url.split("?")[1] ?? "";
  });
});

describe("useUrlPaginationState", () => {
  it("devuelve la misma forma que usePaginationState", () => {
    const local = renderHook(() => usePaginationState());
    const { result } = renderAdapters();

    expect(Object.keys(result.current.pagination).sort()).toEqual(
      Object.keys(local.result.current).sort(),
    );
    expect(result.current.pagination).toMatchObject({ limit: 10, skip: 0 });
  });

  it("deriva skip de page y limit de la URL", () => {
    const { result } = renderAdapters("page=3&limit=20");

    expect(result.current.pagination).toMatchObject({ limit: 20, skip: 40 });
  });

  it("setSkip escribe la página en la URL", () => {
    const { result } = renderAdapters("status=active");

    act(() => result.current.pagination.setSkip(30));

    expect(result.current.pagination.skip).toBe(30);
    expect(result.current.list.state.page).toBe(4);
    expect(mockReplace).toHaveBeenCalledWith("/productos?status=active&page=4", { scroll: false });

    act(() => result.current.pagination.setSkip(0));

    expect(lastReplacedUrl()).toBe("/productos?status=active");
  });

  it("setLimit seguido de setSkip(0), como hace Pagination, deja página 1 con el tamaño nuevo", () => {
    const { result } = renderAdapters("page=4");

    act(() => {
      result.current.pagination.setLimit(50);
      result.current.pagination.setSkip(0);
    });

    expect(result.current.pagination).toMatchObject({ limit: 50, skip: 0 });
    expect(lastReplacedUrl()).toBe("/productos?limit=50");
  });

  it("un cambio de filtro devuelve skip a 0 sin resetDeps", () => {
    const { result } = renderAdapters("page=4");

    act(() => result.current.list.setField("status", "active"));

    expect(result.current.pagination.skip).toBe(0);
  });
});

describe("useUrlSortState", () => {
  it("devuelve la misma forma que useSortState", () => {
    const local = renderHook(() => useSortState());
    const { result } = renderAdapters();

    expect(Object.keys(result.current.sort).sort()).toEqual(Object.keys(local.result.current).sort());
    expect(result.current.sort).toMatchObject({ sortBy: "name", sortOrder: "asc" });
  });

  it("lee el orden de la URL", () => {
    const { result } = renderAdapters("sort=price&dir=desc");

    expect(result.current.sort).toMatchObject({ sortBy: "price", sortOrder: "desc" });
  });

  it("handleSort alterna la dirección y cambia de columna, volviendo a la página 1", () => {
    const { result } = renderAdapters("page=3");

    act(() => result.current.sort.handleSort("name"));

    expect(result.current.sort).toMatchObject({ sortBy: "name", sortOrder: "desc" });
    expect(result.current.list.state.page).toBe(1);
    expect(lastReplacedUrl()).toBe("/productos?dir=desc");

    act(() => result.current.sort.handleSort("price"));

    expect(result.current.sort).toMatchObject({ sortBy: "price", sortOrder: "asc" });
    expect(lastReplacedUrl()).toBe("/productos?sort=price");
  });

  it("ignora una columna que el schema no permite", () => {
    const { result } = renderAdapters("dir=desc");

    act(() => result.current.sort.handleSort("password"));
    act(() => result.current.sort.setSortBy("password"));

    expect(result.current.sort).toMatchObject({ sortBy: "name", sortOrder: "desc" });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("setSortBy y setSortOrder escriben en la URL", () => {
    const { result } = renderAdapters();

    act(() => result.current.sort.setSortBy("price"));
    act(() => result.current.sort.setSortOrder("desc"));

    expect(lastReplacedUrl()).toBe("/productos?sort=price&dir=desc");
  });
});
