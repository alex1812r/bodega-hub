import { renderHook } from "@testing-library/react";

let mockSearch = "";

jest.mock("next/navigation", () => ({
  usePathname: () => "/sales/sale-1",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { useCurrentUrl } from "./useCurrentUrl";

describe("useCurrentUrl", () => {
  afterEach(() => {
    mockSearch = "";
  });

  it("devuelve solo la ruta cuando no hay query", () => {
    expect(renderHook(() => useCurrentUrl()).result.current).toBe("/sales/sale-1");
  });

  it("devuelve la ruta con su query, returnTo incluido", () => {
    mockSearch = `tab=pagos&returnTo=${encodeURIComponent("/sales?page=2")}`;

    expect(renderHook(() => useCurrentUrl()).result.current).toBe(
      "/sales/sale-1?tab=pagos&returnTo=%2Fsales%3Fpage%3D2",
    );
  });
});
