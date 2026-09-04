import "@testing-library/jest-dom";

import { getAuthProfileFromSession } from "./src/lib/supabase/auth/profile.server";

jest.mock("./src/lib/supabase/auth/profile.server");

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
  // Por defecto no hay Authorization: la web se autentica por cookie. Los tests
  // del camino Bearer (app movil) sobreescriben este mock.
  headers: jest.fn(async () => new Headers()),
}));

process.env.ALLOW_DEMO_AUTH = "true";
process.env.API_DATA_SOURCE = "mock";
process.env.NEXT_PUBLIC_API_DATA_SOURCE = "mock";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

beforeEach(() => {
  (getAuthProfileFromSession as jest.Mock).mockResolvedValue(null);
});
