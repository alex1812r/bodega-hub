import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useInvoiceScanImages } from "./useInvoiceScanImages";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

describe("useInvoiceScanImages", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("pide el detalle del escaneo y devuelve sus URLs firmadas", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { imageUrls: ["https://s/1.jpg", "https://s/2.jpg"], scanId: "scan 1" } }),
    );

    const { result } = renderHook(() => useInvoiceScanImages("scan 1"), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.urls).toEqual(["https://s/1.jpg", "https://s/2.jpg"]));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/purchases/invoice-scan/scan%201");
    expect(result.current.isLoading).toBe(false);
  });

  it("expone el error del servidor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "NOT_FOUND", message: "No encontramos ese escaneo de factura." } }, 404),
    );

    const { result } = renderHook(() => useInvoiceScanImages("scan-x"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.error?.message).toBe("No encontramos ese escaneo de factura."));
    expect(result.current.urls).toEqual([]);
  });

  it("sin id no pide nada", () => {
    const { result } = renderHook(() => useInvoiceScanImages(null), { wrapper: createWrapper() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
