import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { SaleImpact, SaleImpactAction } from "@/modules/sales/services/saleImpact";
import { IMPACT_TIMEOUT_MS, IMPACT_UNAVAILABLE_MESSAGE } from "@/shared/impact";

import { allowedSaleImpact } from "../components/saleImpact.testFixtures";
import { useSaleImpact, type UseSaleImpactOptions } from "./useSaleImpact";

/** Impact completo de la venta `sale-001`. */
function saleImpact(
  action: SaleImpactAction,
  overrides: Pick<Partial<SaleImpact>, "paidVes"> = {},
): SaleImpact {
  const impact = allowedSaleImpact(action);

  return { ...impact, document: { ...impact.document, id: "sale-001" }, ...overrides };
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: saleImpact("return") }));

    const { result } = renderHook(
      () => useSaleImpact({ action: "return", enabled: true, saleId: "sale-001" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sales/sale-001/impact?action=return");
    expect(result.current.data).toEqual(saleImpact("return"));
  });

  it("recalcula el efecto cada vez que se abre: no reutiliza la respuesta anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: saleImpact("cancel", { paidVes: 100 }) }))
      .mockResolvedValueOnce(jsonResponse({ data: saleImpact("cancel", { paidVes: 0 }) }));

    const { rerender, result } = renderHook(
      (props: UseSaleImpactOptions) => useSaleImpact(props),
      {
        initialProps: { action: "cancel", enabled: true, saleId: "sale-001" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data?.paidVes).toBe(100));

    rerender({ action: "cancel", enabled: false, saleId: "sale-001" });
    rerender({ action: "cancel", enabled: true, saleId: "sale-001" });

    await waitFor(() => expect(result.current.data?.paidVes).toBe(0));
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

  describe("respuesta que no sirve para mostrar el efecto (CNF-F7 · CAOS-05)", () => {
    const otherSale = saleImpact("return");

    it.each([
      ["sin `document`", { data: omit(saleImpact("return"), "document") }],
      ["sin la lista de stock", { data: omit(saleImpact("return"), "stock") }],
      ["`data: null`", { data: null }],
      ["cuerpo vacío", {}],
      [
        "el impact de OTRA venta",
        { data: { ...otherSale, document: { ...otherSale.document, id: "sale-999" } } },
      ],
      ["el impact de otra acción", { data: saleImpact("cancel") }],
    ])("%s: error con un mensaje claro, sin datos y sin reintentar solo", async (_label, payload) => {
      fetchMock.mockResolvedValue(jsonResponse(payload));

      const { result } = renderHook(
        () => useSaleImpact({ action: "return", enabled: true, saleId: "sale-001" }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(IMPACT_UNAVAILABLE_MESSAGE);
      expect(result.current.data).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("un cuerpo que no es JSON válido no enseña el error técnico", async () => {
      fetchMock.mockResolvedValue({
        headers: { get: () => "application/json" },
        json: async () => {
          throw new SyntaxError("Expected double-quoted property name in JSON at position 24");
        },
        ok: true,
        status: 200,
      } as unknown as Response);

      const { result } = renderHook(
        () => useSaleImpact({ action: "return", enabled: true, saleId: "sale-001" }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(IMPACT_UNAVAILABLE_MESSAGE);
    });

    it("una respuesta que no llega deja de «calcular» pasado el tiempo máximo, y se puede reintentar", async () => {
      jest.useFakeTimers();

      try {
        let signal: AbortSignal | null | undefined;

        fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
          signal = init?.signal;

          return new Promise<Response>(() => undefined);
        });

        const { result } = renderHook(
          () => useSaleImpact({ action: "return", enabled: true, saleId: "sale-001" }),
          { wrapper: createWrapper() },
        );

        await act(async () => {
          await jest.advanceTimersByTimeAsync(IMPACT_TIMEOUT_MS - 1);
        });

        expect(result.current.isPending).toBe(true);
        expect(signal?.aborted).toBe(false);

        await act(async () => {
          await jest.advanceTimersByTimeAsync(1);
        });
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe(IMPACT_UNAVAILABLE_MESSAGE);
        // La petición colgada se corta: no queda viva detrás del error.
        expect(signal?.aborted).toBe(true);

        fetchMock.mockResolvedValueOnce(jsonResponse({ data: saleImpact("return") }));

        await act(async () => {
          void result.current.refetch();
          await jest.advanceTimersByTimeAsync(50);
        });

        await waitFor(() => expect(result.current.data).toEqual(saleImpact("return")));
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
