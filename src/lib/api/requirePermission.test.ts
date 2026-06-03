/**
 * @jest-environment node
 */

import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";

import { ApiError } from "@/lib/api/apiError";
import { requirePermission } from "@/lib/api/requirePermission";

describe("requirePermission", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
    jest.clearAllMocks();
  });

  describe("with ALLOW_DEMO_AUTH=true", () => {
    beforeEach(() => {
      process.env.ALLOW_DEMO_AUTH = "true";
    });

    it("grants permission for demo role", async () => {
      const auth = await requirePermission(
        new Request("http://localhost/api/products", {
          headers: { "x-demo-role": "admin" },
        }),
        "products.manage",
      );

      expect(auth.role).toBe("admin");
      expect(auth.permissions).toContain("products.manage");
    });

    it("prefers session over demo headers when both are present", async () => {
      (getAuthProfileFromSession as jest.Mock).mockResolvedValue({
        deniedPermissions: [],
        email: "vendedor@example.com",
        grantedPermissions: [],
        id: "22222222-2222-4222-8222-222222222222",
        isActive: true,
        name: "Vendedor",
        role: "vendedor",
      });

      await expect(
        requirePermission(
          new Request("http://localhost/api/settings", {
            headers: { "x-demo-role": "admin" },
          }),
          "settings.view",
        ),
      ).rejects.toMatchObject<Partial<ApiError>>({
        status: 403,
        code: "FORBIDDEN",
      });
    });

    it("returns 403 for inactive demo user", async () => {
      await expect(
        requirePermission(
          new Request("http://localhost/api/products", {
            headers: { "x-demo-user-id": "user-inactive" },
          }),
          "products.view",
        ),
      ).rejects.toMatchObject<Partial<ApiError>>({
        status: 403,
        code: "FORBIDDEN",
      });
    });

    it("applies jsonb granted permission overrides", async () => {
      const auth = await requirePermission(
        new Request("http://localhost/api/contacts", {
          headers: { "x-demo-user-id": "55555555-5555-4555-8555-555555555555" },
        }),
        "contacts.manage",
      );

      expect(auth.role).toBe("vendedor");
      expect(auth.permissions).toContain("contacts.manage");
    });

    it("returns 403 when permission is denied by override", async () => {
      await expect(
        requirePermission(
          new Request("http://localhost/api/products", {
            headers: { "x-demo-user-id": "user-warehouse-limited" },
          }),
          "products.manage",
        ),
      ).rejects.toMatchObject<Partial<ApiError>>({
        status: 403,
        code: "FORBIDDEN",
      });
    });
  });

  describe("with ALLOW_DEMO_AUTH=false", () => {
    beforeEach(() => {
      process.env.ALLOW_DEMO_AUTH = "false";
    });

    it("returns 401 when there is no session", async () => {
      (getAuthProfileFromSession as jest.Mock).mockResolvedValue(null);

      await expect(
        requirePermission(new Request("http://localhost/api/products"), "products.view"),
      ).rejects.toMatchObject<Partial<ApiError>>({
        status: 401,
        code: "UNAUTHORIZED",
      });
    });

    it("returns 403 for inactive profile", async () => {
      (getAuthProfileFromSession as jest.Mock).mockResolvedValue({
        deniedPermissions: [],
        email: "inactive@example.com",
        grantedPermissions: [],
        id: "user-inactive",
        isActive: false,
        name: "Inactive",
        role: "vendedor",
      });

      await expect(
        requirePermission(new Request("http://localhost/api/products"), "products.view"),
      ).rejects.toMatchObject<Partial<ApiError>>({
        status: 403,
        code: "FORBIDDEN",
      });
    });

    it("grants permission from session profile with jsonb overrides", async () => {
      (getAuthProfileFromSession as jest.Mock).mockResolvedValue({
        deniedPermissions: ["payments.view"],
        email: "seller@example.com",
        grantedPermissions: ["contacts.manage"],
        id: "22222222-2222-4222-8222-222222222222",
        isActive: true,
        name: "Vendedor",
        role: "vendedor",
      });

      const auth = await requirePermission(
        new Request("http://localhost/api/contacts"),
        "contacts.manage",
      );

      expect(auth.userId).toBe("22222222-2222-4222-8222-222222222222");
      expect(auth.permissions).toContain("contacts.manage");
      expect(auth.permissions).not.toContain("payments.view");
    });
  });
});
