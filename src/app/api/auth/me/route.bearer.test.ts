/**
 * @jest-environment node
 *
 * La misma ruta responde igual autenticada por cookie (web) y por
 * `Authorization: Bearer` (app movil). Aqui se usa el `profile.server` real
 * para cubrir el camino completo header -> getUser(token) -> perfil.
 */

jest.unmock("../../../../lib/supabase/auth/profile.server");
jest.mock("../../../../lib/supabase/route-client");

import { headers } from "next/headers";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET } from "./route";

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

function stubSupabase(getUser: jest.Mock) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: profileRow, error: null })),
        })),
      })),
    })),
  } as unknown as Awaited<ReturnType<typeof createRouteSupabaseClient>>);
}

describe("/api/auth/me with a Bearer token", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  beforeEach(() => {
    jest.clearAllMocks();
    // Demo auth apagado: si el Bearer no funcionara, la ruta daria 401.
    process.env.ALLOW_DEMO_AUTH = "false";
  });

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("returns the profile without any cookie", async () => {
    const getUser = jest.fn(async () => ({
      data: { user: { email: "vendedor@example.com", id: profileRow.id } },
      error: null,
    }));
    stubSupabase(getUser);
    mockedHeaders.mockResolvedValue(
      new Headers({ authorization: "Bearer mobile-access-token" }) as unknown as Awaited<
        ReturnType<typeof headers>
      >,
    );

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { authorization: "Bearer mobile-access-token" },
      }),
    );
    const body = await response.json();

    expect(getUser).toHaveBeenCalledWith("mobile-access-token");
    expect(response.status).toBe(200);
    expect(body.data.role).toBe("vendedor");
    expect(body.data.storeId).toBe(profileRow.store_id);
    expect(body.data.permissions).toContain("sales.create");
    expect(body.data.user.email).toBe("vendedor@example.com");
  });

  it("answers 401 when the token is invalid and demo auth is off", async () => {
    const getUser = jest.fn(async () => ({
      data: { user: null },
      error: { code: "session_not_found", message: "Auth session missing!" },
    }));
    stubSupabase(getUser);
    mockedHeaders.mockResolvedValue(
      new Headers({ authorization: "Bearer expired" }) as unknown as Awaited<
        ReturnType<typeof headers>
      >,
    );

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { authorization: "Bearer expired" },
      }),
    );

    expect(response.status).toBe(401);
  });
});
