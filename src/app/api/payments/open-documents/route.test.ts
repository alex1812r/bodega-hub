/**
 * @jest-environment node
 */

jest.mock("../../../../modules/payments/services/openDocuments.mock-server", () => {
  const actual = jest.requireActual<
    typeof import("@/modules/payments/services/openDocuments.mock-server")
  >("../../../../modules/payments/services/openDocuments.mock-server");

  // Envuelve el servicio real para poder observar con que argumentos lo llama la ruta.
  return { ...actual, listOpenDocuments: jest.fn(actual.listOpenDocuments) };
});

import { listOpenDocuments } from "@/modules/payments/services/openDocuments.mock-server";

import { GET } from "./route";

const listOpenDocumentsSpy = jest.mocked(listOpenDocuments);

const BASE_URL = "http://localhost/api/payments/open-documents";

function get(query = "", role?: string) {
  return GET(
    new Request(`${BASE_URL}${query}`, {
      headers: role ? { "x-demo-role": role } : undefined,
    }),
  );
}

describe("GET /api/payments/open-documents", () => {
  beforeEach(() => {
    listOpenDocumentsSpy.mockClear();
  });

  it("returns sales and purchases with balance plus totals for a role that manages payments", async () => {
    const response = await get("?limit=100", "contador");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ limit: 100, skip: 0 });
    expect(body.data.total).toBe(body.data.totals.count);
    expect(body.data.totals.truncated).toBe(false);

    const types = new Set(body.data.items.map((item: { type: string }) => item.type));
    expect(types).toEqual(new Set(["sale", "purchase"]));

    body.data.items.forEach((item: { pendingVes: number; status: string }) => {
      expect(item.pendingVes).toBeGreaterThan(0);
      expect(["pendiente_pago", "pagada", "pedido", "recibido"]).toContain(item.status);
    });

    const dates = body.data.items.map((item: { createdAt: string }) =>
      new Date(item.createdAt).getTime(),
    );
    expect(dates).toEqual([...dates].sort((left, right) => left - right));
  });

  it("returns the documented item shape", async () => {
    const response = await get("?type=sale&search=V-000002", "contador");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toEqual({
      contact: expect.objectContaining({ id: "cont-both", name: "Comercial Doble Via" }),
      createdAt: "2026-05-18T15:10:00.000Z",
      id: "sale-002",
      number: "V-000002",
      paidVes: expect.any(Number),
      pendingRef: expect.any(Number),
      pendingVes: expect.any(Number),
      refRateVes: 510,
      status: "pendiente_pago",
      totalRef: 22.5,
      totalVes: 11475,
      type: "sale",
    });
  });

  it("gives a seller only sales when no type is sent", async () => {
    const response = await get("?limit=100", "vendedor");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    body.data.items.forEach((item: { type: string }) => expect(item.type).toBe("sale"));
  });

  it("lets a seller ask for sales explicitly", async () => {
    const response = await get("?type=sale", "vendedor");

    expect(response.status).toBe(200);
  });

  it("rejects a seller asking for purchases", async () => {
    const response = await get("?type=purchase", "vendedor");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a role without payments.manage nor sales.create", async () => {
    const response = await get("", "almacen");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns only purchases for type=purchase", async () => {
    const response = await get("?type=purchase&limit=100", "contador");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    body.data.items.forEach((item: { type: string }) => expect(item.type).toBe("purchase"));
  });

  it("passes validated filters, pagination, allowed types and the server store to the service", async () => {
    const response = await get(
      "?type=sale&search=%20Central%20&contactId=cont-customer&from=2026-05-01&to=2026-05-31&olderThanDays=7&limit=20&skip=40&storeId=otra-tienda",
      "contador",
    );

    expect(response.status).toBe(200);
    expect(listOpenDocumentsSpy).toHaveBeenCalledWith(
      {
        contactId: "cont-customer",
        from: "2026-05-01",
        limit: 20,
        olderThanDays: 7,
        search: "Central",
        skip: 40,
        to: "2026-05-31",
        types: ["sale"],
      },
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("treats blank params as absent", async () => {
    const response = await get("?type=&search=%20&from=&olderThanDays=", "vendedor");

    expect(response.status).toBe(200);
    expect(listOpenDocumentsSpy).toHaveBeenCalledWith({ limit: 10, skip: 0, types: ["sale"] }, expect.any(String));
  });

  it.each([
    ["an unknown type", "?type=payment"],
    ["a malformed from", "?from=18-05-2026"],
    ["an impossible date", "?to=2026-02-31"],
    ["from after to", "?from=2026-06-02&to=2026-06-01"],
    ["olderThanDays = 0", "?olderThanDays=0"],
    ["a negative olderThanDays", "?olderThanDays=-3"],
    ["a decimal olderThanDays", "?olderThanDays=1.5"],
    ["a non numeric olderThanDays", "?olderThanDays=abc"],
  ])("rejects %s with 400", async (_label, query) => {
    const response = await get(query, "contador");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(listOpenDocumentsSpy).not.toHaveBeenCalled();
  });
});
