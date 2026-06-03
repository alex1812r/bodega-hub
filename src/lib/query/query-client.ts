import {
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";

import { ClientApiError } from "@/shared/api/apiFetch";

function shouldRedirectToLogin() {
  if (typeof window === "undefined") {
    return false;
  }

  const { pathname } = window.location;

  if (pathname === "/login") {
    return false;
  }

  if (pathname.startsWith("/api-docs") || pathname.startsWith("/dev/")) {
    return false;
  }

  return true;
}

function handleUnauthorized(error: unknown) {
  if (!(error instanceof ClientApiError) || error.status !== 401) {
    return;
  }

  if (!shouldRedirectToLogin()) {
    return;
  }

  const next = encodeURIComponent(
    `${window.location.pathname}${window.location.search}`,
  );

  window.location.assign(`/login?next=${next}`);
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
