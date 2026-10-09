import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { IMPACT_UNAVAILABLE_MESSAGE } from "@/shared/impact";

import { usePaymentImpact, type UsePaymentImpactOptions } from "./usePaymentImpact";

/** Lo que el hook exige del impact del pago `pay-001` (las cifras no le importan). */
function paymentImpact(overrides: Record<string, unknown> = {}) {
  return {
    action: "cancel",
    allowed: true,
    description: "El cobro se anula y el dinero sale de la caja.",
    document: {
      contactName: "María Pérez",
      id: "sale-001",
      kind: "sale",
      number: "V-20261009-000007",
      status: "pagada",
      statusAfter: "pendiente_pago",
    },
    effects: [],
    inexact: null,
    payment: { id: "pay-001" },
    reason: null,
    reasonCode: null,
    ...overrides,
  };
}

function omit(impact: object, key: string) {
  return Object.fromEntries(Object.entries(impact).filter(([name]) => name !== key));
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: paymentImpact() }));

    const { result } = renderHook(() => usePaymentImpact({ enabled: true, paymentId: "pay-001" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/payments/pay-001/impact?action=cancel");
    expect(result.current.data).toEqual(paymentImpact());
  });

  it("recalcula el efecto cada vez que se abre: no reutiliza la respuesta anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: paymentImpact({ description: "primera" }) }))
      .mockResolvedValueOnce(jsonResponse({ data: paymentImpact({ description: "segunda" }) }));

    const { rerender, result } = renderHook(
      (props: UsePaymentImpactOptions) => usePaymentImpact(props),
      {
        initialProps: { enabled: true, paymentId: "pay-001" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data?.description).toBe("primera"));

    rerender({ enabled: false, paymentId: "pay-001" });
    rerender({ enabled: true, paymentId: "pay-001" });

    await waitFor(() => expect(result.current.data?.description).toBe("segunda"));
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

  describe("respuesta que no sirve para mostrar el efecto (CNF-F7 · CAOS-05)", () => {
    it.each([
      ["sin `document`", { data: omit(paymentImpact(), "document") }],
      ["sin `payment`", { data: omit(paymentImpact(), "payment") }],
      ["sin la lista de asientos", { data: omit(paymentImpact(), "effects") }],
      ["`data: null`", { data: null }],
      ["el impact de OTRO pago", { data: paymentImpact({ payment: { id: "pay-999" } }) }],
    ])("%s: error con un mensaje claro y sin datos", async (_label, payload) => {
      fetchMock.mockResolvedValue(jsonResponse(payload));

      const { result } = renderHook(
        () => usePaymentImpact({ enabled: true, paymentId: "pay-001" }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(IMPACT_UNAVAILABLE_MESSAGE);
      expect(result.current.data).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
