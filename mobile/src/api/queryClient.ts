import { QueryClient } from "@tanstack/react-query";

import { ApiClientError, NetworkError } from "./apiClient";

/**
 * Politica de reintentos: nunca en 4xx (401/403 no mejoran reintentando) y
 * nunca en mutaciones, porque `POST /api/sales` no es idempotente.
 */
function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiClientError && error.status < 500) {
    return false;
  }

  if (error instanceof NetworkError) {
    return failureCount < 1;
  }

  return failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        // La cache persistida es lo que da la lectura offline.
        gcTime: 24 * 60 * 60 * 1000,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
