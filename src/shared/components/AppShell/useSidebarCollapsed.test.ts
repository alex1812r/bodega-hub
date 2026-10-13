import { act, renderHook } from "@testing-library/react";

import { useSidebarCollapsed } from "./useSidebarCollapsed";

const STORAGE_KEY = "bodega-hub:sidebar-collapsed";

describe("useSidebarCollapsed", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("starts expanded and persists that default when nothing is stored", () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("restores the stored preference on mount", () => {
    localStorage.setItem(STORAGE_KEY, "true");

    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("toggles and persists, and a remount reads the persisted value", () => {
    const first = renderHook(() => useSidebarCollapsed());

    act(() => first.result.current.toggle());
    expect(first.result.current.collapsed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");

    act(() => first.result.current.toggle());
    expect(first.result.current.collapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");

    act(() => first.result.current.toggle());
    first.unmount();

    const second = renderHook(() => useSidebarCollapsed());
    expect(second.result.current.collapsed).toBe(true);
  });

  it("does not follow storage changes made after mount", () => {
    const { result, rerender } = renderHook(() => useSidebarCollapsed());

    localStorage.setItem(STORAGE_KEY, "true");
    rerender();

    expect(result.current.collapsed).toBe(false);
  });

  it("keeps working in memory when storage is unavailable", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });
});
