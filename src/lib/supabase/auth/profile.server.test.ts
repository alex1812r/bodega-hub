/**
 * @jest-environment node
 */

jest.unmock("./profile.server");

import { headers } from "next/headers";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { getAuthProfileFromSession } from "./profile.server";

jest.mock("../route-client");

const mockedHeaders = headers as jest.MockedFunction<typeof headers>;
const mockedCreateClient = createRouteSupabaseClient as jest.MockedFunction<
  typeof createRouteSupabaseClient
>;

const profileRow = {
  denied_permissions: [],
  full_name: "Vendedor Demo",
  granted_permissions: [],
  id: "22222222-2222-4222-8222-222222222222",
  is_active: true,
  role: "vendedor",
  store_id: "11111111-1111-4111-8111-111111111111",
};

function buildSupabaseStub(getUser: jest.Mock) {
  return {
    auth: { getUser },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: profileRow, error: null })),
        })),
      })),
    })),
  };
}

function withAuthorization(value?: string) {
  mockedHeaders.mockResolvedValue(
    new Headers(value ? { authorization: value } : {}) as unknown as Awaited<
      ReturnType<typeof headers>
    >,
  );
}

describe("getAuthProfileFromSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves the user from the Bearer token when the request carries one", async () => {
    const getUser = jest.fn(async () => ({
      data: { user: { email: "vendedor@example.com", id: profileRow.id } },
      error: null,
    }));
    mockedCreateClient.mockResolvedValue(
      buildSupabaseStub(getUser) as unknown as Awaited<
        ReturnType<typeof createRouteSupabaseClient>
      >,
    );
    withAuthorization("Bearer mobile-access-token");

    const profile = await getAuthProfileFromSession();

    // Sin el token explicito, getUser leeria cookies y devolveria null -> 401.
    expect(getUser).toHaveBeenCalledWith("mobile-access-token");
    expect(profile).toMatchObject({
      email: "vendedor@example.com",
      id: profileRow.id,
      isActive: true,
      role: "vendedor",
      storeId: profileRow.store_id,
    });
  });

  it("keeps the cookie session path untouched when there is no header", async () => {
    const getUser = jest.fn(async () => ({
      data: { user: { email: "vendedor@example.com", id: profileRow.id } },
      error: null,
    }));
    mockedCreateClient.mockResolvedValue(
      buildSupabaseStub(getUser) as unknown as Awaited<
        ReturnType<typeof createRouteSupabaseClient>
      >,
    );
    withAuthorization();

    const profile = await getAuthProfileFromSession();

    expect(getUser).toHaveBeenCalledWith(undefined);
    expect(profile?.role).toBe("vendedor");
  });

  it.each([
    ["malformed", { code: "bad_jwt", message: "invalid JWT: token is malformed", status: 403 }],
    ["expired", { code: "bad_jwt", message: "invalid JWT: token is expired", status: 401 }],
    ["revoked session", { code: "session_not_found", message: "Session from session_id not found", status: 401 }],
  ])("answers unauthenticated (not a server error) for a %s token", async (_label, error) => {
    const getUser = jest.fn(async () => ({ data: { user: null }, error }));
    mockedCreateClient.mockResolvedValue(
      buildSupabaseStub(getUser) as unknown as Awaited<
        ReturnType<typeof createRouteSupabaseClient>
      >,
    );
    withAuthorization("Bearer whatever");

    // Debe ser null -> 401, nunca una excepcion -> 500: la app movil refresca y reintenta.
    await expect(getAuthProfileFromSession()).resolves.toBeNull();
  });

  it("still surfaces a real Supabase outage as an error", async () => {
    const getUser = jest.fn(async () => ({
      data: { user: null },
      error: { code: "unexpected_failure", message: "Database is unavailable", status: 500 },
    }));
    mockedCreateClient.mockResolvedValue(
      buildSupabaseStub(getUser) as unknown as Awaited<
        ReturnType<typeof createRouteSupabaseClient>
      >,
    );
    withAuthorization("Bearer whatever");

    await expect(getAuthProfileFromSession()).rejects.toThrow();
  });

  it("returns null when the token is rejected", async () => {
    const getUser = jest.fn(async () => ({
      data: { user: null },
      error: { code: "session_not_found", message: "Auth session missing!" },
    }));
    mockedCreateClient.mockResolvedValue(
      buildSupabaseStub(getUser) as unknown as Awaited<
        ReturnType<typeof createRouteSupabaseClient>
      >,
    );
    withAuthorization("Bearer expired-token");

    await expect(getAuthProfileFromSession()).resolves.toBeNull();
  });
});
