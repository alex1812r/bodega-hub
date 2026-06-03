/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/users/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("updates user role and status", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/users/user-seller", {
        body: JSON.stringify({ isActive: false, role: "contador" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
      context("user-seller"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("contador");
    expect(body.data.isActive).toBe(false);
  });

  it("updates user permission overrides", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/users/user-seller", {
        body: JSON.stringify({
          deniedPermissions: ["payments.view"],
          grantedPermissions: ["contacts.manage"],
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
      context("user-seller"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.grantedPermissions).toContain("contacts.manage");
    expect(body.data.deniedPermissions).toContain("payments.view");
  });

  it("validates permission overrides", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/users/user-seller", {
        body: JSON.stringify({
          grantedPermissions: ["unknown.permission"],
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
      context("user-seller"),
    );

    expect(response.status).toBe(400);
  });

  describe("supabase data source", () => {
    const mockMaybeSingle = jest.fn();
    const mockEq = jest.fn(() => ({
      select: jest.fn(() => ({
        maybeSingle: mockMaybeSingle,
      })),
    }));
    const mockUpdate = jest.fn();

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockMaybeSingle.mockResolvedValue({
        data: {
          denied_permissions: ["payments.view"],
          full_name: "Vendedor Demo",
          granted_permissions: ["contacts.manage"],
          id: "user-seller",
          is_active: false,
          role: "contador",
        },
        error: null,
      });
      mockUpdate.mockReturnValue({
        eq: mockEq,
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          update: mockUpdate,
        })),
      });
      (createAdminSupabaseClient as jest.Mock).mockReturnValue({
        auth: {
          admin: {
            listUsers: jest.fn().mockResolvedValue({
              data: { users: [{ email: "vendedor@example.com", id: "user-seller" }] },
              error: null,
            }),
          },
        },
      });
    });

    it("updates a user profile in supabase", async () => {
      const response = await PATCH(
        new Request("http://localhost/api/users/user-seller", {
          body: JSON.stringify({ isActive: false, role: "contador" }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
        context("user-seller"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          email: "vendedor@example.com",
          id: "user-seller",
          isActive: false,
          role: "contador",
        }),
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_active: false,
          role: "contador",
        }),
      );
    });
  });
});
