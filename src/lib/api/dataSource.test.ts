/**
 * @jest-environment node
 */

import { resolveDataSource } from "@/lib/api/dataSource";

describe("resolveDataSource", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults to mock in test environment", () => {
    delete process.env.API_DATA_SOURCE;

    expect(resolveDataSource()).toBe("mock");
  });

  it("respects explicit supabase value", () => {
    process.env.API_DATA_SOURCE = "supabase";

    expect(resolveDataSource()).toBe("supabase");
  });

  it("defaults to supabase outside test", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.API_DATA_SOURCE;

    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      value: "production",
      writable: true,
    });

    expect(resolveDataSource()).toBe("supabase");

    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      value: originalNodeEnv,
      writable: true,
    });
  });
});
