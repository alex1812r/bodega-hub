/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { mockUserProfiles } from "@/shared/mocks/erp-data";

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

  describe("último administrador activo de la tienda (CAOS-03)", () => {
    const patchAdmin = (body: Record<string, unknown>) =>
      PATCH(
        new Request("http://localhost/api/users/user-admin", {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
        context("user-admin"),
      );
    const storedAdmin = () => mockUserProfiles.find((profile) => profile.id === "user-admin");

    it.each([
      ["quitarse el rol", { role: "vendedor" }],
      ["desactivarse", { isActive: false }],
    ])("responde 409 CONFLICT al %s y no cambia nada", async (_label, body) => {
      const response = await patchAdmin(body);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "CONFLICT",
          message: "La tienda debe conservar al menos un administrador activo.",
        },
      });
      expect(storedAdmin()).toMatchObject({ isActive: true, role: "admin" });
    });

    it("con otro administrador activo en la tienda responde 200", async () => {
      const snapshot = mockUserProfiles.map((profile) => ({ ...profile }));

      mockUserProfiles.push({
        email: "admin2@example.com",
        id: "user-admin-2",
        isActive: true,
        name: "Admin Dos",
        role: "admin",
        storeId: storedAdmin()?.storeId,
      });

      try {
        const response = await patchAdmin({ role: "vendedor" });

        expect(response.status).toBe(200);
        expect((await response.json()).data.role).toBe("vendedor");
      } finally {
        mockUserProfiles.splice(0, mockUserProfiles.length, ...snapshot);
      }
    });
  });

  describe("supabase data source", () => {
    const mockMaybeSingle = jest.fn();
    const mockSelect = jest.fn(() => ({
      maybeSingle: mockMaybeSingle,
    }));
    const chain = {
      eq: jest.fn(),
      maybeSingle: mockMaybeSingle,
      select: mockSelect,
    };
    chain.eq.mockReturnValue(chain);
    const mockUpdate = jest.fn(() => chain);

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
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          // Lectura previa de CAOS-03 (rol y estado actuales del usuario).
          select: jest.fn(() => chain),
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
