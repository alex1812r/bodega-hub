/**
 * @jest-environment node
 */

import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";

import { GET } from "./route";

describe("/api/auth/me", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  beforeEach(() => {
    process.env.ALLOW_DEMO_AUTH = "true";
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("returns current demo user from header role when there is no session", async () => {
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("contador");
    expect(body.data.permissions).toContain("reports.view");
    expect(body.data.permissions).not.toContain("products.manage");
  });

  it("prefers session profile over demo headers", async () => {
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue({
      deniedPermissions: [],
      email: "vendedor@example.com",
      grantedPermissions: [],
      id: "22222222-2222-4222-8222-222222222222",
      isActive: true,
      name: "Vendedor Demo",
      role: "vendedor",
    });

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { "x-demo-role": "admin", "x-demo-user-id": "user-admin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("vendedor");
    expect(body.data.permissions).toContain("sales.create");
    expect(body.data.permissions).not.toContain("contacts.manage");
    expect(body.data.permissions).not.toContain("settings.view");
  });

  it("returns user-specific permission overrides in demo mode", async () => {
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { "x-demo-user-id": "55555555-5555-4555-8555-555555555555" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("vendedor");
    expect(body.data.grantedPermissions).toContain("contacts.manage");
    expect(body.data.permissions).toContain("contacts.manage");
  });
});
