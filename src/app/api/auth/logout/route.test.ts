/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { POST } from "./route";

describe("/api/auth/logout", () => {
  const mockSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      auth: {
        signOut: mockSignOut,
      },
    });
  });

  it("signs out and clears session cookies", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.signedOut).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
  });
});
