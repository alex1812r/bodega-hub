/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET, POST } from "./route";

describe("/api/categories", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns categories", async () => {
    const response = await GET(new Request("http://localhost/api/categories"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cat-tools" })]),
    );
    expect(body.data.items.every((category: { isActive: boolean }) => category.isActive)).toBe(
      true,
    );
  });

  it("lists inactive categories when filtered", async () => {
    const response = await GET(new Request("http://localhost/api/categories?isActive=false"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.every((category: { isActive: boolean }) => !category.isActive)).toBe(
      true,
    );
  });

  it("creates a simulated category with warehouse role", async () => {
    const response = await POST(
      new Request("http://localhost/api/categories", {
        body: JSON.stringify({ description: "Categoria demo", name: "Demo" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.name).toBe("Demo");
  });

  it("blocks category creation for sellers", async () => {
    const response = await POST(
      new Request("http://localhost/api/categories", {
        body: JSON.stringify({ name: "Demo" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("lists categories from supabase with pagination", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn().mockReturnThis(),
            ilike: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            range: jest.fn().mockResolvedValue({
              count: 1,
              data: [{ description: "Tools", id: "cat-1", is_active: true, name: "Herramientas" }],
              error: null,
            }),
          })),
        })),
      });

      const response = await GET(new Request("http://localhost/api/categories"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({ id: "cat-1", name: "Herramientas" }),
      ]);
      expect(body.data.total).toBe(1);
    });
  });
});
