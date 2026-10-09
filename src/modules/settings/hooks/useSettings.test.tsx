import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useCashCloseSettings,
  usePricingSettings,
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

  it("loads the pricing settings from the read-only endpoint of product viewers", async () => {
    const pricing = { chipsPct: [5, 50], greenFromPct: 40, yellowFromPct: 10 };
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: pricing }));

    const { result } = renderHook(() => usePricingSettings(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(pricing);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/settings/pricing");
  });

  it("loads the cash close threshold from the read-only endpoint of cash operators", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { cashCloseDiffAlertVes: 150 } }));

    const { result } = renderHook(() => useCashCloseSettings(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ cashCloseDiffAlertVes: 150 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/settings/cash-close");
  });

  it("saving the settings refreshes the cached cash close threshold without another request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { cashCloseDiffAlertVes: 0 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            businessName: "BodegaHub",
            cashCloseDiffAlertVes: 75,
            enabledPaymentMethods: ["efectivo_ves"],
            pricing: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 },
          },
        }),
      );

    const { result } = renderHook(
      () => ({ cashClose: useCashCloseSettings(), update: useUpdateSettings() }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.cashClose.data).toEqual({ cashCloseDiffAlertVes: 0 }));

    result.current.update.mutate({ cashCloseDiffAlertVes: 75 });

    await waitFor(() => expect(result.current.cashClose.data).toEqual({ cashCloseDiffAlertVes: 75 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("loads settings and users", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            businessName: "BodegaHub",
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
