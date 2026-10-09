/**
 * DET-04 (D24) · las sublistas del contacto piden su página al servidor
 * (`skip`/`limit`) y cada página tiene su propia entrada de caché.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  contactsQueryKeys,
  useContactActivity,
  useContactPayments,
  useContactPurchases,
  useContactSales,
} from "./useContacts";

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("sublistas del contacto paginadas", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: { items: [], limit: 10, skip: 10, total: 25 } }),
    );
    global.fetch = fetchMock;
  });

  it.each([
    ["payments", useContactPayments],
    ["sales", useContactSales],
    ["purchases", useContactPurchases],
    ["activity", useContactActivity],
  ] as const)("%s: envía skip y limit al BFF", async (resource, useList) => {
    const { result } = renderHook(() => useList("cont-1", { limit: 10, skip: 10 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/contacts/cont-1/${resource}?limit=10&skip=10`,
      expect.any(Object),
    );
  });

  it("cada página tiene su clave, colgada del detalle del contacto", () => {
    const pageOne = contactsQueryKeys.payments("cont-1", { limit: 10, skip: 0 });
    const pageTwo = contactsQueryKeys.payments("cont-1", { limit: 10, skip: 10 });

    expect(pageOne).not.toEqual(pageTwo);
    // Invalidar el detalle del contacto refresca todas sus páginas.
    expect(pageTwo.slice(0, 3)).toEqual(contactsQueryKeys.detail("cont-1"));
  });
});
