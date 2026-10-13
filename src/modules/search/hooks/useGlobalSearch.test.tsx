import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { GLOBAL_SEARCH_DEBOUNCE_MS, useGlobalSearch } from "./useGlobalSearch";

const EMPTY = { contacts: [], products: [], purchases: [], sales: [] };

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function requestedTerms() {
  return (global.fetch as jest.Mock).mock.calls.map(([url]) =>
    new URL(String(url), "http://localhost").searchParams.get("q"),
  );
}

describe("useGlobalSearch", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => jsonResponse({ data: EMPTY })) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(["", "a", "  a  ", "%%", "_"])("does not query for %p", (input) => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useGlobalSearch(input), { wrapper: createWrapper() });

    act(() => {
      jest.advanceTimersByTime(GLOBAL_SEARCH_DEBOUNCE_MS * 4);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      isError: false,
      isLoading: false,
      isTooShort: true,
      results: undefined,
    });
  });

  it("waits for the debounce, sends the trimmed term and returns its results", async () => {
    const { rerender, result } = renderHook(({ input }) => useGlobalSearch(input), {
      initialProps: { input: "" },
      wrapper: createWrapper(),
    });

    rerender({ input: "  taladro   percutor " });

    expect(result.current).toMatchObject({ isLoading: true, term: "taladro percutor" });
    expect(global.fetch).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.results).toEqual(EMPTY));

    expect(requestedTerms()).toEqual(["taladro percutor"]);
    expect(result.current.isLoading).toBe(false);
  });

  it("queries at once on flush, without waiting for the debounce", async () => {
    jest.useFakeTimers();

    const { rerender, result } = renderHook(({ input }) => useGlobalSearch(input), {
      initialProps: { input: "" },
      wrapper: createWrapper(),
    });

    rerender({ input: "7501234567890" });

    expect(global.fetch).not.toHaveBeenCalled();

    act(() => {
      result.current.flush();
    });

    expect(requestedTerms()).toEqual(["7501234567890"]);

    jest.useRealTimers();
    await waitFor(() => expect(result.current.results).toEqual(EMPTY));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("never hands over the results of a previous term", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) =>
      jsonResponse({
        data: url.includes("q=uno")
          ? { ...EMPTY, products: [{ barcode: null, id: "p1", name: "Uno", sku: "u-1" }] }
          : EMPTY,
      }),
    );

    const { rerender, result } = renderHook(({ input }) => useGlobalSearch(input), {
      initialProps: { input: "uno" },
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.results?.products).toHaveLength(1));

    rerender({ input: "dos" });

    expect(result.current.results).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.results).toEqual(EMPTY));
  });

  it("reports the failure of the current term", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500),
    );

    const { result } = renderHook(() => useGlobalSearch("taladro"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.results).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});
