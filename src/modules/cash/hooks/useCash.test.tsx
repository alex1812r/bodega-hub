import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  cashKeys,
  useCashCloseTotals,
  useCashMovements,
  useCashRegisters,
  useCloseCashSession,
  useMyCashSession,
  useOpenCashSession,
  type CashCloseTotals,
  type CashSessionTotals,
} from "./useCash";

/** El mismo `staleTime` que el cliente de la app (`src/lib/query/query-client.ts`). */
const APP_STALE_TIME_MS = 30_000;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function totals(theoreticalVes: number): CashSessionTotals {
  return { accountVes: 0, items: [], theoretical: { ref: 0, ves: theoreticalVes } };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function createClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: APP_STALE_TIME_MS },
    },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("cash hooks", () => {
  const fetchMock = jest.fn();

  function requestedUrls() {
    return fetchMock.mock.calls.map(([url]) => String(url));
  }

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  describe("useCashMovements", () => {
    it("reads the movements of the session it is given and exposes them", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: totals(120) }));

      const { result } = renderHook(() => useCashMovements("session-1"), {
        wrapper: wrapperFor(createClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(totals(120));
      expect(requestedUrls()).toEqual(["/api/cash/movements?sessionId=session-1"]);
      expect(fetchMock.mock.calls[0][1]?.method ?? "GET").toBe("GET");
    });

    it("does not ask the server while there is no session", () => {
      const { result } = renderHook(() => useCashMovements(undefined), {
        wrapper: wrapperFor(createClient()),
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reuses a recent cache on mount when alwaysFresh is not requested", async () => {
      const queryClient = createClient();
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: totals(120) }));

      const first = renderHook(() => useCashMovements("session-1"), {
        wrapper: wrapperFor(queryClient),
      });
      await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
      first.unmount();

      const second = renderHook(() => useCashMovements("session-1"), {
        wrapper: wrapperFor(queryClient),
      });

      expect(second.result.current.data).toEqual(totals(120));
      expect(second.result.current.isFetching).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("asks again on mount with alwaysFresh even though the cache is recent", async () => {
      const queryClient = createClient();
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: totals(120) }))
        .mockResolvedValueOnce(jsonResponse({ data: totals(175) }));

      const first = renderHook(() => useCashMovements("session-1"), {
        wrapper: wrapperFor(queryClient),
      });
      await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
      first.unmount();

      const second = renderHook(() => useCashMovements("session-1", { alwaysFresh: true }), {
        wrapper: wrapperFor(queryClient),
      });

      expect(second.result.current.isFetching).toBe(true);
      await waitFor(() => expect(second.result.current.data).toEqual(totals(175)));
      expect(requestedUrls()).toEqual([
        "/api/cash/movements?sessionId=session-1",
        "/api/cash/movements?sessionId=session-1",
      ]);
    });
  });

  describe("useCashCloseTotals", () => {
    function renderCloseTotals(queryClient: QueryClient, initialOpen: boolean) {
      const renders: CashCloseTotals[] = [];
      const view = renderHook(
        ({ open }: { open: boolean }) => {
          const value = useCashCloseTotals("session-1", open);
          renders.push(value);
          return value;
        },
        { initialProps: { open: initialOpen }, wrapper: wrapperFor(queryClient) },
      );

      return { ...view, renders };
    }

    it("stays loading without asking the server while the close is not open", () => {
      const { result } = renderCloseTotals(createClient(), false);

      expect(result.current).toMatchObject({ errorMessage: null, status: "loading", totals: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("goes from loading to ready with the totals read after opening", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: totals(120) }));

      const { result } = renderCloseTotals(createClient(), true);

      expect(result.current.status).toBe("loading");
      await waitFor(() => expect(result.current.status).toBe("ready"));

      expect(result.current.totals).toEqual(totals(120));
      expect(result.current.errorMessage).toBeNull();
      expect(requestedUrls()).toEqual(["/api/cash/movements?sessionId=session-1"]);
    });

    it("never reports a recent cache as ready: opening the close reads again first", async () => {
      const queryClient = createClient();
      const pending = deferred<Response>();
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: totals(120) }))
        .mockReturnValueOnce(pending.promise);

      // La pantalla de caja deja la lectura en caché (reciente para el `staleTime` de la app).
      const screen = renderHook(() => useCashMovements("session-1"), {
        wrapper: wrapperFor(queryClient),
      });
      await waitFor(() => expect(screen.result.current.isSuccess).toBe(true));

      const { renders, result } = renderCloseTotals(queryClient, true);

      expect(result.current.status).toBe("loading");
      expect(result.current.totals).toEqual(totals(120));
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        pending.resolve(jsonResponse({ data: totals(175) }));
        await pending.promise;
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      expect(result.current.totals).toEqual(totals(175));
      expect(
        renders.filter((render) => render.status === "ready").map((render) => render.totals),
      ).toEqual(expect.arrayContaining([totals(175)]));
      expect(
        renders.some(
          (render) => render.status === "ready" && render.totals?.theoretical.ves === 120,
        ),
      ).toBe(false);
    });

    it("reads again on every opening and is not ready with the previous reading meanwhile", async () => {
      const pending = deferred<Response>();
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: totals(120) }))
        .mockReturnValueOnce(pending.promise);

      const { renders, rerender, result } = renderCloseTotals(createClient(), true);
      await waitFor(() => expect(result.current.status).toBe("ready"));

      rerender({ open: false });
      expect(result.current.status).toBe("loading");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const rendersBeforeReopening = renders.length;
      rerender({ open: true });

      expect(result.current.status).toBe("loading");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        pending.resolve(jsonResponse({ data: totals(175) }));
        await pending.promise;
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      expect(result.current.totals).toEqual(totals(175));
      expect(
        renders
          .slice(rendersBeforeReopening)
          .some((render) => render.status === "ready" && render.totals?.theoretical.ves === 120),
      ).toBe(false);
    });

    it("reports the server message on a 500 and recovers with retry", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            { error: { code: "INTERNAL_ERROR", message: "La caja no respondió a tiempo." } },
            500,
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ data: totals(175) }));

      const { result } = renderCloseTotals(createClient(), true);

      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.errorMessage).toBe("La caja no respondió a tiempo.");
      expect(result.current.totals).toBeNull();

      act(() => result.current.retry());

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.errorMessage).toBeNull();
      expect(result.current.totals).toEqual(totals(175));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("is an error, not ready, when the reading of a reopening fails over a previous one", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: totals(120) }))
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Sin conexión con la caja." } }, 500),
        );

      const { renders, rerender, result } = renderCloseTotals(createClient(), true);
      await waitFor(() => expect(result.current.status).toBe("ready"));

      rerender({ open: false });
      const rendersBeforeReopening = renders.length;
      rerender({ open: true });

      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.errorMessage).toBe("Sin conexión con la caja.");
      expect(
        renders.slice(rendersBeforeReopening).some((render) => render.status === "ready"),
      ).toBe(false);
    });
  });

  describe("session mutations", () => {
    function routeCashApi(sessionMutation: Response) {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return sessionMutation;
        }
        if (url.startsWith("/api/cash/movements")) {
          return jsonResponse({ data: totals(120) });
        }
        if (url === "/api/cash/registers") {
          return jsonResponse({ data: [] });
        }
        return jsonResponse({ data: null });
      });
    }

    function renderCashScreen(queryClient: QueryClient) {
      return renderHook(
        () => ({
          close: useCloseCashSession(),
          movements: useCashMovements("session-1"),
          open: useOpenCashSession(),
          registers: useCashRegisters(),
          session: useMyCashSession(),
        }),
        { wrapper: wrapperFor(queryClient) },
      );
    }

    async function waitForInitialReads(view: ReturnType<typeof renderCashScreen>) {
      await waitFor(() => {
        expect(view.result.current.movements.isSuccess).toBe(true);
        expect(view.result.current.registers.isSuccess).toBe(true);
        expect(view.result.current.session.isSuccess).toBe(true);
      });
    }

    it("opening a session posts the body and invalidates every cash key so they are read again", async () => {
      const queryClient = createClient();
      const invalidate = jest.spyOn(queryClient, "invalidateQueries");
      routeCashApi(jsonResponse({ data: { id: "session-2", status: "open" } }));

      const view = renderCashScreen(queryClient);
      await waitForInitialReads(view);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const body = { openingRef: 10, openingVes: 500, registerId: "register-1" };
      act(() => view.result.current.open.mutate(body));

      await waitFor(() => expect(view.result.current.open.isSuccess).toBe(true));

      const [url, init] = fetchMock.mock.calls[3];
      expect(url).toBe("/api/cash/session/open");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual(body);

      expect(invalidate).toHaveBeenCalledWith({ queryKey: cashKeys.all });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
      expect(requestedUrls().slice(4).sort()).toEqual([
        "/api/cash/movements?sessionId=session-1",
        "/api/cash/registers",
        "/api/cash/session",
      ]);
      [
        cashKeys.session,
        cashKeys.registers,
        cashKeys.movements("session-1"),
      ].forEach((queryKey) => {
        expect(queryClient.getQueryState(queryKey)?.dataUpdateCount).toBe(2);
      });
    });

    it("closing a session invalidates the cash keys as well", async () => {
      const queryClient = createClient();
      routeCashApi(jsonResponse({ data: { id: "session-1", status: "closed" } }));

      const view = renderCashScreen(queryClient);
      await waitForInitialReads(view);

      act(() => view.result.current.close.mutate({ closingRef: 10, closingVes: 620 }));

      await waitFor(() => expect(view.result.current.close.isSuccess).toBe(true));
      expect(fetchMock.mock.calls[3][0]).toBe("/api/cash/session/close");
      await waitFor(() => {
        expect(queryClient.getQueryState(cashKeys.session)?.dataUpdateCount).toBe(2);
        expect(queryClient.getQueryState(cashKeys.movements("session-1"))?.dataUpdateCount).toBe(2);
      });
    });

    it("a rejected opening exposes the server message and leaves the cache untouched", async () => {
      const queryClient = createClient();
      const invalidate = jest.spyOn(queryClient, "invalidateQueries");
      routeCashApi(
        jsonResponse(
          { error: { code: "PT409", message: "Ya tienes una caja abierta." } },
          409,
        ),
      );

      const view = renderCashScreen(queryClient);
      await waitForInitialReads(view);

      act(() => view.result.current.open.mutate({ registerId: "register-1" }));

      await waitFor(() => expect(view.result.current.open.isError).toBe(true));
      expect(view.result.current.open.error?.message).toBe("Ya tienes una caja abierta.");
      expect(invalidate).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});
