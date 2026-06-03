import {
  getConnectedToApiPhrase,
  getConnectedToLayerPhrase,
  isMockDataSource,
  resolveClientDataSource,
} from "./dataSourceUi";

describe("dataSourceUi", () => {
  const original = process.env.NEXT_PUBLIC_API_DATA_SOURCE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_API_DATA_SOURCE;
    } else {
      process.env.NEXT_PUBLIC_API_DATA_SOURCE = original;
    }
  });

  it("defaults to supabase when unset", () => {
    delete process.env.NEXT_PUBLIC_API_DATA_SOURCE;

    expect(resolveClientDataSource()).toBe("supabase");
    expect(isMockDataSource()).toBe(false);
    expect(getConnectedToLayerPhrase()).toBe("conectado a Supabase");
  });

  it("reflects mock mode", () => {
    process.env.NEXT_PUBLIC_API_DATA_SOURCE = "mock";

    expect(isMockDataSource()).toBe(true);
    expect(getConnectedToApiPhrase()).toBe("conectado a la API mock");
  });

  it("reflects supabase mode", () => {
    process.env.NEXT_PUBLIC_API_DATA_SOURCE = "supabase";

    expect(isMockDataSource()).toBe(false);
    expect(getConnectedToApiPhrase()).toBe("conectado a Supabase");
  });
});
