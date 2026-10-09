import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { usePaymentImpact, type UsePaymentImpactOptions } from "./usePaymentImpact";

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

describe("usePaymentImpact", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("no pide nada mientras el modal está cerrado o falta el pago", () => {
    const wrapper = createWrapper();

    renderHook(() => usePaymentImpact({ enabled: false, paymentId: "pay-001" }), { wrapper });
    renderHook(() => usePaymentImpact({ enabled: true }), { wrapper });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pide el impact de anular al abrir el modal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { action: "cancel", allowed: true } }));

    const { result } = renderHook(() => usePaymentImpact({ enabled: true, paymentId: "pay-001" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/payments/pay-001/impact?action=cancel");
    expect(result.current.data).toEqual({ action: "cancel", allowed: true });
  });

  it("recalcula el efecto cada vez que se abre: no reutiliza la respuesta anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { description: "primera" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { description: "segunda" } }));

    const { rerender, result } = renderHook(
      (props: UsePaymentImpactOptions) => usePaymentImpact(props),
      {
        initialProps: { enabled: true, paymentId: "pay-001" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toEqual({ description: "primera" }));

    rerender({ enabled: false, paymentId: "pay-001" });
    rerender({ enabled: true, paymentId: "pay-001" });

    await waitFor(() => expect(result.current.data).toEqual({ description: "segunda" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expone el error sin reintentar", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Pago no encontrado." } }, 404),
    );

    const { result } = renderHook(() => usePaymentImpact({ enabled: true, paymentId: "pay-404" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatchObject({ message: "Pago no encontrado.", status: 404 });
    expect(result.current.data).toBeUndefined();
  });
});
