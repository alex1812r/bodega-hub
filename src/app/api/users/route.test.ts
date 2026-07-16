/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET } from "./route";

describe("/api/users", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns users for admin", async () => {
    const response = await GET(new Request("http://localhost/api/users"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "admin" })]),
    );
  });

  it("blocks users list for seller", async () => {
    const response = await GET(
      new Request("http://localhost/api/users", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });

  describe("supabase data source", () => {
    const mockRange = jest.fn();
    const mockSelect = jest.fn(() => ({
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: mockRange,
    }));

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockRange.mockResolvedValue({
        count: 1,
        data: [
          {
            denied_permissions: [],
            full_name: "Admin Demo",
            granted_permissions: [],
            id: "user-admin",
            is_active: true,
            role: "admin",
          },
        ],
        error: null,
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          select: mockSelect,
        })),
      });
      (createAdminSupabaseClient as jest.Mock).mockReturnValue({
        auth: {
          admin: {
            listUsers: jest.fn().mockResolvedValue({
              data: { users: [{ email: "admin@example.com", id: "user-admin" }] },
              error: null,
            }),
          },
        },
      });
    });

    it("lists users from supabase with auth emails", async () => {
      const response = await GET(new Request("http://localhost/api/users?skip=0&limit=10"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({
          email: "admin@example.com",
          id: "user-admin",
          name: "Admin Demo",
          role: "admin",
        }),
      ]);
      expect(body.data.total).toBe(1);
    });
  });
});
