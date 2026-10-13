/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET, POST } from "./route";

describe("/api/contacts", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  // POS-H2: una página más allá del total es una lista vacía con el total real, no un error.
  it.each(["skip=999999", "skip=999999&limit=20&type=cliente", "skip=2147483648"])(
    "%s → 200 con lista vacía y el total real",
    async (query) => {
      const filters = query.includes("type=") ? "&type=cliente" : "";
      const firstPage = await GET(new Request(`http://localhost/api/contacts?limit=10${filters}`));
      const firstBody = await firstPage.json();
      const response = await GET(new Request(`http://localhost/api/contacts?${query}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([]);
      expect(firstBody.data.total).toBeGreaterThan(0);
      expect(body.data.total).toBe(firstBody.data.total);
      expect(body.data.skip).toBe(Number(new URLSearchParams(query).get("skip")));
    },
  );

  it("returns contacts", async () => {
    const response = await GET(new Request("http://localhost/api/contacts"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("filters contacts by isActive and returns both states without the parameter", async () => {
    const active = await GET(new Request("http://localhost/api/contacts?isActive=true&limit=100"));
    const inactive = await GET(new Request("http://localhost/api/contacts?isActive=false&limit=100"));
    const all = await GET(new Request("http://localhost/api/contacts?limit=100"));
    const activeBody = await active.json();
    const inactiveBody = await inactive.json();
    const allBody = await all.json();

    expect(activeBody.data.items.length).toBeGreaterThan(0);
    expect(activeBody.data.items.every((contact: { isActive: boolean }) => contact.isActive)).toBe(
      true,
    );
    expect(inactiveBody.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cont-inactive" })]),
    );
    expect(
      inactiveBody.data.items.every((contact: { isActive: boolean }) => !contact.isActive),
    ).toBe(true);
    expect(allBody.data.total).toBe(activeBody.data.total + inactiveBody.data.total);
  });

  it("creates a simulated contact", async () => {
    const response = await POST(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({
          email: "nuevo@example.com",
          name: "Nuevo Cliente",
          type: "cliente",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.name).toBe("Nuevo Cliente");
  });

  it("blocks contact creation with view-only role permissions", async () => {
    const response = await POST(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({
          name: "Cliente sin permiso",
          type: "cliente",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("lists only customer contacts for vendedor", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.every((contact: { type: string }) => contact.type === "cliente")).toBe(
      true,
    );
  });

  it("forbids vendedor from filtering supplier contacts", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts?type=proveedor", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("allows contact creation with a user-specific permission grant", async () => {
    const response = await POST(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({
          name: "Cliente con permiso extra",
          type: "cliente",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-user-id": "55555555-5555-4555-8555-555555555555",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.name).toBe("Cliente con permiso extra");
  });

  it("rejects duplicate tax id", async () => {
    const response = await POST(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({
          name: "Cliente duplicado",
          taxId: "J-00000001-1",
          type: "cliente",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  describe("supabase data source", () => {
    const mockRange = jest.fn();
    const mockEq = jest.fn().mockReturnThis();
    const mockSelect = jest.fn(() => ({
      eq: mockEq,
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: mockRange,
    }));

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockRange.mockResolvedValue({
        count: 1,
        data: [
          {
            address: "Av. Principal",
            email: "cliente@example.com",
            id: "11111111-1111-4111-8111-111111111111",
            is_active: true,
            name: "Cliente Supabase",
            phone: "0412-0000001",
            tax_id: "J-00000001-1",
            type: "cliente",
          },
        ],
        error: null,
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          select: mockSelect,
        })),
      });
    });

    it("lists contacts from supabase with pagination", async () => {
      const response = await GET(new Request("http://localhost/api/contacts?skip=0&limit=10"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({
          id: "11111111-1111-4111-8111-111111111111",
          name: "Cliente Supabase",
          type: "cliente",
        }),
      ]);
      expect(body.data.total).toBe(1);
      expect(mockRange).toHaveBeenCalledWith(0, 9);
      expect(mockEq).not.toHaveBeenCalledWith("is_active", expect.anything());
    });

    it("applies isActive in supabase like the mock does", async () => {
      const response = await GET(new Request("http://localhost/api/contacts?isActive=true&limit=8"));

      expect(response.status).toBe(200);
      expect(mockEq).toHaveBeenCalledWith("is_active", true);
      expect(mockEq).toHaveBeenCalledWith("store_id", "00000000-0000-4000-8000-000000000001");
    });
  });
});
