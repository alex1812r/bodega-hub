/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/supabase/auth/profile.server");

import { getProfileByUserId } from "@/lib/supabase/auth/profile.server";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { POST } from "./route";

describe("/api/auth/login", () => {
  const mockSignInWithPassword = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    });
    (getProfileByUserId as jest.Mock).mockResolvedValue({
      deniedPermissions: [],
      email: "admin@example.com",
      grantedPermissions: [],
      id: "11111111-1111-4111-8111-111111111111",
      isActive: true,
      name: "Admin Demo",
      role: "admin",
    });
  });

  it("signs in and returns user profile from cookies flow", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: {
          email: "admin@example.com",
          id: "11111111-1111-4111-8111-111111111111",
        },
      },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "Admin123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("admin");
    expect(body.data.user.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "Admin123!",
    });
  });

  it("returns 401 for invalid credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "wrong",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
