import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useCreateExchangeRate,
  useCurrentExchangeRate,
  useExchangeRates,
} from "./useCurrentExchangeRate";

function paginated<T>(items: T[]) {
  return { items, limit: 10, skip: 0, total: items.length };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return Wrapper;
}

describe("useCurrentExchangeRate", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads the current ref/VES exchange rate", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          createdAt: "2026-05-18T12:00:00.000Z",
          id: "rate-current",
          rateVes: 510,
          source: "BCV",
        },
      }),
    );

    const { result } = renderHook(() => useCurrentExchangeRate(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rateVes).toBe(510);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/exchange-rates/current",
      expect.any(Object),
    );
  });

  it("loads exchange rate history with date filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: paginated([
          {
            createdAt: "2026-05-18T12:00:00.000Z",
            id: "rate-current",
            rateVes: 510,
            source: "BCV",
          },
        ]),
      }),
    );

    const { result } = renderHook(
      () => useExchangeRates({ from: "2026-05-01", to: "2026-05-31" }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/exchange-rates?from=2026-05-01&to=2026-05-31",
      expect.any(Object),
    );
  });

  it("registers a new ref/VES exchange rate", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          data: {
            createdAt: "2026-05-20T12:00:00.000Z",
            id: "rate-new",
            rateVes: 525,
            source: "Manual",
          },
        },
        201,
      ),
    );

    const { result } = renderHook(() => useCreateExchangeRate(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ rateVes: 525, source: "Manual" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/exchange-rates",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
