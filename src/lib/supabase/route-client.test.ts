/**
 * @jest-environment node
 */

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { createRouteSupabaseClient } from "./route-client";

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({ marker: "supabase-client" })),
}));

const mockedCreateServerClient = createServerClient as jest.MockedFunction<
  typeof createServerClient
>;
const mockedHeaders = headers as jest.MockedFunction<typeof headers>;
const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;

function withAuthorization(value?: string) {
  mockedHeaders.mockResolvedValue(
    new Headers(value ? { authorization: value } : {}) as unknown as Awaited<
      ReturnType<typeof headers>
    >,
  );
}

function lastOptions() {
  const call = mockedCreateServerClient.mock.calls.at(-1);

  if (!call) {
    throw new Error("createServerClient no fue llamado");
  }

  return call[2] as {
    cookies: { getAll: () => unknown[]; setAll: (value: unknown) => void };
    global?: { headers?: Record<string, string> };
  };
}

describe("createRouteSupabaseClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("without an Authorization header (web)", () => {
    it("keeps reading and writing the request cookies", async () => {
      const set = jest.fn();
      const getAll = jest.fn(() => [{ name: "sb-access-token", value: "cookie-token" }]);
      mockedCookies.mockResolvedValue({ getAll, set } as unknown as Awaited<
        ReturnType<typeof cookies>
      >);
      withAuthorization();

      await createRouteSupabaseClient();

      const options = lastOptions();
      expect(options.global?.headers?.Authorization).toBeUndefined();
      expect(options.cookies.getAll()).toEqual([
        { name: "sb-access-token", value: "cookie-token" },
      ]);

      options.cookies.setAll([{ name: "sb-access-token", value: "next", options: {} }]);
      expect(set).toHaveBeenCalledWith("sb-access-token", "next", {});
    });
  });

  describe("with an Authorization header (mobile)", () => {
    it("forwards the token to PostgREST and does not touch cookies", async () => {
      withAuthorization("Bearer mobile-access-token");

      await createRouteSupabaseClient();

      const options = lastOptions();
      expect(options.global?.headers?.Authorization).toBe("Bearer mobile-access-token");
      expect(options.cookies.getAll()).toEqual([]);
      expect(mockedCookies).not.toHaveBeenCalled();
      expect(() =>
        options.cookies.setAll([{ name: "sb-access-token", value: "x", options: {} }]),
      ).not.toThrow();
    });

    it("falls back to cookies when the scheme is not Bearer", async () => {
      const getAll = jest.fn(() => []);
      mockedCookies.mockResolvedValue({ getAll, set: jest.fn() } as unknown as Awaited<
        ReturnType<typeof cookies>
      >);
      withAuthorization("Basic dXNlcjpwYXNz");

      await createRouteSupabaseClient();

      expect(lastOptions().global?.headers?.Authorization).toBeUndefined();
      expect(mockedCookies).toHaveBeenCalled();
    });
  });
});
