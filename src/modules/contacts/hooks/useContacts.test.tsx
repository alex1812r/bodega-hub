import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useContact,
  useContactActivity,
  useContactPayments,
  useContactPurchases,
  useContacts,
  useContactSales,
  useCreateContact,
  useUpdateContact,
} from "./useContacts";

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

describe("contact hooks", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("loads contacts with filters", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          items: [{ id: "cont-customer", name: "Ferreteria La Central" }],
          limit: 10,
          skip: 0,
          total: 1,
        },
      }),
    );

    const { result } = renderHook(
      () => useContacts({ search: "central", type: "cliente" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts?search=central&type=cliente",
      expect.any(Object),
    );
  });

  it("loads contact detail and related activity resources", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "cont-customer" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { items: [{ id: "sale-001" }], limit: 10, skip: 0, total: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { items: [{ id: "purchase-001" }], limit: 10, skip: 0, total: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { items: [{ id: "pay-001" }], limit: 10, skip: 0, total: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            items: [{ id: "sale-001", type: "sale" }],
            limit: 10,
            skip: 0,
            total: 1,
          },
        }),
      );

    const contact = renderHook(() => useContact("cont-customer"), {
      wrapper: createWrapper(),
    });
    const sales = renderHook(() => useContactSales("cont-customer"), {
      wrapper: createWrapper(),
    });
    const purchases = renderHook(() => useContactPurchases("cont-customer"), {
      wrapper: createWrapper(),
    });
    const payments = renderHook(() => useContactPayments("cont-customer"), {
      wrapper: createWrapper(),
    });
    const activity = renderHook(() => useContactActivity("cont-customer"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(contact.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(sales.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(purchases.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(payments.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(activity.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/cont-customer",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/cont-customer/sales",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/cont-customer/purchases",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/cont-customer/payments",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/cont-customer/activity",
      expect.any(Object),
    );
  });

  it("creates and updates contacts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "cont-new" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "cont-customer" } }));

    const createContact = renderHook(() => useCreateContact(), {
      wrapper: createWrapper(),
    });
    const updateContact = renderHook(() => useUpdateContact("cont-customer"), {
      wrapper: createWrapper(),
    });

    createContact.result.current.mutate({
      email: "nuevo@example.com",
      name: "Contacto nuevo",
      type: "cliente",
    });
    await waitFor(() => expect(createContact.result.current.isSuccess).toBe(true));

    updateContact.result.current.mutate({ phone: "0412-1234567" });
    await waitFor(() => expect(updateContact.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/cont-customer",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
