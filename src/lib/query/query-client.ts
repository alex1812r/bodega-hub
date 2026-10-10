import {
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";

import { ClientApiError } from "@/shared/api/apiFetch";
import { redirectToLoginOnSessionExpired } from "@/shared/auth/loginRedirect";

/**
 * Red de seguridad: `apiFetch` ya redirige en cualquier 401. La redirección es
 * idempotente (`redirectToLoginOnSessionExpired`), así que no se duplica.
 */
function handleUnauthorized(error: unknown) {
  if (error instanceof ClientApiError && error.status === 401) {
    redirectToLoginOnSessionExpired();
  }
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
    mutationCache: new MutationCache({
      onError: handleUnauthorized,
    }),
    queryCache: new QueryCache({
      onError: handleUnauthorized,
    }),
  });
}
