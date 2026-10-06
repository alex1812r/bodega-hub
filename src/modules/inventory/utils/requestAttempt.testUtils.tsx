import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** Utilidades de los tests de UI de idempotencia (STK-511 · C6). Solo para jest. */

export function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

export type PostCall = { body: Record<string, unknown>; url: string };

/**
 * `fetch` de prueba: los GET responden con `getData(url)`; cada POST consume la
 * siguiente respuesta encolada (una `Response`, un error de red o una promesa
 * que el test resuelve a mano) y queda registrado en `posts`.
 */
export function installFetchStub(getData: (url: string) => unknown) {
  const posts: PostCall[] = [];
  const queue: Array<() => Promise<Response>> = [];
  const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method !== "POST") {
      return Promise.resolve(jsonResponse({ data: getData(url) }));
    }

    posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, url });

    const next = queue.shift();

    return next ? next() : Promise.reject(new Error("POST inesperado en el test"));
  });

  global.fetch = fetchMock as unknown as typeof fetch;

  return {
    posts,
    /** El siguiente POST queda en vuelo hasta llamar a la funcion devuelta. */
    holdNextPost(payload: unknown, status = 201) {
      let release: () => void = () => undefined;
      const pending = new Promise<Response>((resolve) => {
        release = () => resolve(jsonResponse(payload, status));
      });

      queue.push(() => pending);

      return () => release();
    },
    networkErrorOnNextPost() {
      queue.push(() => Promise.reject(new TypeError("Failed to fetch")));
    },
    respondToNextPost(payload: unknown, status = 201) {
      queue.push(() => Promise.resolve(jsonResponse(payload, status)));
    },
  };
}
