import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useSaleImpact, type UseSaleImpactOptions } from "./useSaleImpact";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  // Sin `retry: false` aquí: el hook debe traer el suyo.
  const queryClient = new QueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

describe("useSaleImpact", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("no pide nada mientras el modal está cerrado o falta la venta", () => {
    const wrapper = createWrapper();

    renderHook(() => useSaleImpact({ action: "cancel", enabled: false, saleId: "sale-001" }), {
      wrapper,
    });
    renderHook(() => useSaleImpact({ action: "cancel", enabled: true }), { wrapper });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pide el impact de la acción al abrir el modal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { action: "return", allowed: true } }));

    const { result } = renderHook(
      () => useSaleImpact({ action: "return", enabled: true, saleId: "sale-001" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sales/sale-001/impact?action=return");
    expect(result.current.data).toEqual({ action: "return", allowed: true });
  });

  it("recalcula el efecto cada vez que se abre: no reutiliza la respuesta anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { paidVes: 100 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { paidVes: 0 } }));

    const { rerender, result } = renderHook(
      (props: UseSaleImpactOptions) => useSaleImpact(props),
      {
        initialProps: { action: "cancel", enabled: true, saleId: "sale-001" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toEqual({ paidVes: 100 }));

    rerender({ action: "cancel", enabled: false, saleId: "sale-001" });
    rerender({ action: "cancel", enabled: true, saleId: "sale-001" });

    await waitFor(() => expect(result.current.data).toEqual({ paidVes: 0 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expone el error sin reintentar", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Venta no encontrada." } }, 404),
    );

    const { result } = renderHook(
      () => useSaleImpact({ action: "cancel", enabled: true, saleId: "sale-404" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatchObject({ message: "Venta no encontrada.", status: 404 });
    expect(result.current.data).toBeUndefined();
  });
});
