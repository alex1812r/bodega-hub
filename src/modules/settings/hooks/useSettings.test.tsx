import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useSettings,
  useUpdateSettings,
  useUpdateUser,
  useUsers,
} from "./useSettings";

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

describe("settings hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads settings and users", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            businessName: "Control Ventas ERP",
            defaultTaxRate: 0,
            invoicePrefix: "V",
            lowStockThreshold: 5,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: paginated([{ id: "user-admin", name: "Admin Demo", role: "admin" }]),
        }),
      );

    const settings = renderHook(() => useSettings(), {
      wrapper: createWrapper(),
    });
    const users = renderHook(() => useUsers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(settings.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(users.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith("/api/users", expect.any(Object));
  });

  it("updates settings and users", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            businessName: "Ferreteria Demo",
            defaultTaxRate: 16,
            invoicePrefix: "FD",
            lowStockThreshold: 8,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "user-seller", isActive: false, role: "vendedor" },
        }),
      );

    const updateSettings = renderHook(() => useUpdateSettings(), {
      wrapper: createWrapper(),
    });
    const updateUser = renderHook(() => useUpdateUser("user-seller"), {
      wrapper: createWrapper(),
    });

    updateSettings.result.current.mutate({
      businessName: "Ferreteria Demo",
      defaultTaxRate: 16,
    });
    await waitFor(() => expect(updateSettings.result.current.isSuccess).toBe(true));

    updateUser.result.current.mutate({ isActive: false });
    await waitFor(() => expect(updateUser.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/user-seller",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
