import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { PurchaseImpact, PurchaseImpactAction } from "@/modules/purchases/services/purchaseImpact";
import { IMPACT_UNAVAILABLE_MESSAGE } from "@/shared/impact";

import {
  allowedPurchaseImpact,
  rejectedPurchaseImpact,
} from "../components/purchaseImpact.testFixtures";
import { usePurchaseImpact, type UsePurchaseImpactOptions } from "./usePurchaseImpact";

function ofPurchase(impact: PurchaseImpact, purchaseId: string): PurchaseImpact {
  return { ...impact, document: { ...impact.document, id: purchaseId } };
}

/** Impact completo y permitido de la compra `purchaseId`. */
function purchaseImpact(action: PurchaseImpactAction, purchaseId = "purchase-001") {
  return ofPurchase(allowedPurchaseImpact(action), purchaseId);
}

function rejectedImpact(action: PurchaseImpactAction, purchaseId = "purchase-001") {
  return ofPurchase(rejectedPurchaseImpact(action, "La compra ya fue cancelada o devuelta"), purchaseId);
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

describe("usePurchaseImpact", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("no pide nada mientras el modal está cerrado o falta la compra", () => {
    const wrapper = createWrapper();

    renderHook(
      () => usePurchaseImpact({ action: "cancel", enabled: false, purchaseId: "purchase-001" }),
      { wrapper },
    );
    renderHook(() => usePurchaseImpact({ action: "cancel", enabled: true }), { wrapper });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["receive", "cancel", "return"] as const)(
    "pide el impact de %s al abrir el modal",
    async (action) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: purchaseImpact(action) }));

      const { result } = renderHook(
        () => usePurchaseImpact({ action, enabled: true, purchaseId: "purchase-001" }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/purchases/purchase-001/impact?action=${action}`);
      expect(result.current.data).toEqual(purchaseImpact(action));
    },
  );

  it("recibir con lista: la envía como JSON y vuelve a pedir el efecto cuando cambia", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: purchaseImpact("receive", "purchase-002") }))
      .mockResolvedValueOnce(jsonResponse({ data: rejectedImpact("receive", "purchase-002") }));

    const { rerender, result } = renderHook(
      (props: UsePurchaseImpactOptions) => usePurchaseImpact(props),
      {
        initialProps: {
          action: "receive",
          disassemble: [{ purchaseItemId: "item-1" }],
          enabled: true,
          purchaseId: "purchase-002",
        },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data?.allowed).toBe(true));

    rerender({ action: "receive", disassemble: [], enabled: true, purchaseId: "purchase-002" });

    await waitFor(() => expect(result.current.data?.allowed).toBe(false));

    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url), "http://localhost"));

    expect(urls.map((url) => url.pathname)).toEqual([
      "/api/purchases/purchase-002/impact",
      "/api/purchases/purchase-002/impact",
    ]);
    expect(urls.map((url) => url.searchParams.get("action"))).toEqual(["receive", "receive"]);
    expect(urls.map((url) => JSON.parse(url.searchParams.get("disassemble") ?? "null"))).toEqual([
      [{ purchaseItemId: "item-1" }],
      [],
    ]);
  });

  it("la lista no viaja en cancelar ni devolver", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: purchaseImpact("cancel") }));

    const { result } = renderHook(
      () =>
        usePurchaseImpact({
          action: "cancel",
          disassemble: [{ purchaseItemId: "item-1" }],
          enabled: true,
          purchaseId: "purchase-001",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock.mock.calls[0][0]).toBe("/api/purchases/purchase-001/impact?action=cancel");
  });

  it("recalcula el efecto cada vez que se abre: no reutiliza la respuesta anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: purchaseImpact("return") }))
      .mockResolvedValueOnce(jsonResponse({ data: rejectedImpact("return") }));

    const { rerender, result } = renderHook(
      (props: UsePurchaseImpactOptions) => usePurchaseImpact(props),
      {
        initialProps: { action: "return", enabled: true, purchaseId: "purchase-001" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data?.allowed).toBe(true));

    rerender({ action: "return", enabled: false, purchaseId: "purchase-001" });
    rerender({ action: "return", enabled: true, purchaseId: "purchase-001" });

    await waitFor(() => expect(result.current.data?.allowed).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expone el error sin reintentar", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Compra no encontrada." } }, 404),
    );

    const { result } = renderHook(
      () => usePurchaseImpact({ action: "cancel", enabled: true, purchaseId: "purchase-404" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatchObject({ message: "Compra no encontrada.", status: 404 });
    expect(result.current.data).toBeUndefined();
  });

  describe("respuesta que no sirve para mostrar el efecto (CNF-F7 · CAOS-05)", () => {
    it.each([
      ["sin `document`", { data: omit(purchaseImpact("receive"), "document") }],
      ["sin la lista de costos", { data: omit(purchaseImpact("receive"), "costs") }],
      ["`data: null`", { data: null }],
      ["el impact de OTRA compra", { data: purchaseImpact("receive", "purchase-999") }],
      ["el impact de otra acción", { data: purchaseImpact("cancel") }],
    ])("%s: error con un mensaje claro y sin datos", async (_label, payload) => {
      fetchMock.mockResolvedValue(jsonResponse(payload));

      const { result } = renderHook(
        () => usePurchaseImpact({ action: "receive", enabled: true, purchaseId: "purchase-001" }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(IMPACT_UNAVAILABLE_MESSAGE);
      expect(result.current.data).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
