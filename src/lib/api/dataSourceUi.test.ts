import {
  getConnectedToApiPhrase,
  getConnectedToLayerPhrase,
  getPageDataSourceSuffix,
  isDemoAuthEnabledUi,
  isDevToolkitEnabledUi,
  isMockDataSource,
  resolveClientDataSource,
} from "./dataSourceUi";

describe("dataSourceUi", () => {
  const originalDataSource = process.env.NEXT_PUBLIC_API_DATA_SOURCE;
  const originalDemoAuth = process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalDataSource === undefined) {
      delete process.env.NEXT_PUBLIC_API_DATA_SOURCE;
    } else {
      process.env.NEXT_PUBLIC_API_DATA_SOURCE = originalDataSource;
    }

    if (originalDemoAuth === undefined) {
      delete process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH;
    } else {
      process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH = originalDemoAuth;
    }

    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      value: originalNodeEnv,
      writable: true,
    });
  });

  it("defaults to supabase when unset", () => {
    delete process.env.NEXT_PUBLIC_API_DATA_SOURCE;

    expect(resolveClientDataSource()).toBe("supabase");
    expect(isMockDataSource()).toBe(false);
    expect(getConnectedToLayerPhrase()).toBe("");
    expect(getPageDataSourceSuffix()).toBe(".");
  });

  it("reflects mock mode", () => {
    process.env.NEXT_PUBLIC_API_DATA_SOURCE = "mock";

    expect(isMockDataSource()).toBe(true);
    expect(getConnectedToApiPhrase()).toBe("conectado a la API mock");
    expect(getPageDataSourceSuffix()).toBe(" conectado a la API mock.");
  });

  it("reflects supabase mode without dev copy", () => {
    process.env.NEXT_PUBLIC_API_DATA_SOURCE = "supabase";

    expect(isMockDataSource()).toBe(false);
    expect(getConnectedToApiPhrase()).toBe("");
  });

  it("enables dev toolkit in development or demo/mock flags", () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      value: "production",
      writable: true,
    });
    delete process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH;
    process.env.NEXT_PUBLIC_API_DATA_SOURCE = "supabase";

    expect(isDevToolkitEnabledUi()).toBe(false);
    expect(isDemoAuthEnabledUi()).toBe(false);

    process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH = "true";

    expect(isDevToolkitEnabledUi()).toBe(true);
    expect(isDemoAuthEnabledUi()).toBe(true);
  });
});
