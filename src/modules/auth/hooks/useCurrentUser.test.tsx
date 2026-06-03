import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { authQueryKeys, useCurrentUser } from "./useCurrentUser";

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

  return { queryClient, Wrapper };
}

describe("useCurrentUser", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads the current user profile from /api/auth/me", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          deniedPermissions: [],
          grantedPermissions: ["sales.create"],
          permissionCatalog: ["dashboard.view", "sales.create"],
          permissions: ["dashboard.view", "sales.create"],
          role: "vendedor",
          roles: ["admin", "vendedor"],
          user: {
            email: "seller@example.com",
            id: "user-seller",
            isActive: true,
            name: "Vendedor Demo",
          },
        },
      }),
    );

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.role).toBe("vendedor");
    expect(result.current.data?.permissions).toContain("sales.create");
    expect(result.current.data?.grantedPermissions).toContain("sales.create");
    expect(result.current.data?.deniedPermissions).toEqual([]);
    expect(result.current.data?.user.name).toBe("Vendedor Demo");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.any(Object));
  });

  it("uses authQueryKeys.me for the query key", () => {
    expect(authQueryKeys.me()).toEqual(["auth", "me"]);
  });
});
