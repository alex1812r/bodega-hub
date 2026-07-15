import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";

import { useLogin } from "./useLogin";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: jest.fn(),
  }),
}));

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
      mutations: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(authQueryKeys.me(), {
    role: "admin",
    user: { id: "stale", isActive: true, name: "Stale" },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { queryClient, Wrapper };
}

describe("useLogin", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    global.fetch = fetchMock;
  });

  it("posts credentials to /api/auth/login and redirects to /dashboard", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          role: "admin",
          user: {
            email: "admin@example.com",
            id: "user-admin",
            isActive: true,
            name: "Administrador",
          },
        },
      }),
    );

    const { queryClient, Wrapper } = createWrapper();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useLogin(), { wrapper: Wrapper });

    result.current.mutate({
      email: "admin@example.com",
      password: "secret",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "admin@example.com",
          password: "secret",
        }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: authQueryKeys.all });
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to next path when safe", async () => {
    window.history.pushState({}, "", "/login?next=/products");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          role: "admin",
          user: {
            email: "admin@example.com",
            id: "user-admin",
            isActive: true,
            name: "Administrador",
          },
        },
      }),
    );

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useLogin(), { wrapper: Wrapper });

    result.current.mutate({
      email: "admin@example.com",
      password: "secret",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(pushMock).toHaveBeenCalledWith("/products");

    window.history.pushState({}, "", "/");
  });
});
