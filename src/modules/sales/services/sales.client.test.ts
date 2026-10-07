/**
 * @jest-environment node
 */

import { ClientApiError } from "@/shared/api/apiFetch";

import { getSaleByClientRequestId } from "./sales.client";

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("getSaleByClientRequestId", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("asks the by-request endpoint and returns the sale", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { id: "sale-1", invoiceNumber: "V-000001", items: [], payments: [] } }),
    );

    const sale = await getSaleByClientRequestId(CLIENT_REQUEST_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/sales/by-request/${CLIENT_REQUEST_ID}`);
    expect(sale).toEqual(expect.objectContaining({ id: "sale-1", invoiceNumber: "V-000001" }));
  });

  it("returns null when the server says no sale has that key (404)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Venta no encontrada." } }),
    );

    await expect(getSaleByClientRequestId(CLIENT_REQUEST_ID)).resolves.toBeNull();
  });

  it("rethrows any other failure: the sale may exist", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "Ocurrio un error inesperado." } }),
    );
    await expect(getSaleByClientRequestId(CLIENT_REQUEST_ID)).rejects.toBeInstanceOf(ClientApiError);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getSaleByClientRequestId(CLIENT_REQUEST_ID)).rejects.toThrow("Failed to fetch");
  });
});
