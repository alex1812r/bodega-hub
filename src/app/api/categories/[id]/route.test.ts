/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { DELETE, GET, PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/categories/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns a category by id", async () => {
    const response = await GET(
      new Request("http://localhost/api/categories/cat-tools"),
      context("cat-tools"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("Herramientas");
  });

  it("returns not found for unknown category", async () => {
    const response = await GET(
      new Request("http://localhost/api/categories/missing"),
      context("missing"),
    );

    expect(response.status).toBe(404);
  });

  it("updates a category", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/categories/cat-tools", {
        body: JSON.stringify({ name: "Herramientas Pro" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "PATCH",
      }),
      context("cat-tools"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("Herramientas Pro");
  });

  it("deletes a category in mock mode", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/categories/cat-tools", {
        headers: { "x-demo-role": "almacen" },
        method: "DELETE",
      }),
      context("cat-tools"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("soft deletes a category in supabase", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          update: jest.fn(() => ({
            eq: jest.fn().mockReturnThis(),
            select: jest.fn(() => ({
              maybeSingle: jest.fn().mockResolvedValue({
                data: {
                  description: "Tools",
                  id: "cat-1",
                  is_active: false,
                  name: "Herramientas",
                },
                error: null,
              }),
            })),
          })),
        })),
      });

      const response = await DELETE(
        new Request("http://localhost/api/categories/cat-1", {
          headers: { "x-demo-role": "almacen" },
          method: "DELETE",
        }),
        context("cat-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.deleted).toBe(true);
    });
  });
});
