import * as SecureStore from "expo-secure-store";

import { secureChunkStorage } from "./secureChunkStorage";

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe("secureChunkStorage", () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  it("round-trips a short value", async () => {
    await secureChunkStorage.setItem("sb-session", "hola");

    await expect(secureChunkStorage.getItem("sb-session")).resolves.toBe("hola");
  });

  it("splits a session larger than the SecureStore limit and rebuilds it", async () => {
    // Una sesion de Supabase con el objeto `user` pasa de 2 KB.
    const session = "x".repeat(5000);

    await secureChunkStorage.setItem("sb-session", session);

    const writtenKeys = [...store.keys()];
    expect(writtenKeys.length).toBeGreaterThan(2);
    expect(writtenKeys).toContain("sb-session.chunks");
    // Ningun trozo puede acercarse al limite de SecureStore.
    for (const [key, value] of store) {
      if (key.endsWith(".chunks")) continue;
      expect(value.length).toBeLessThanOrEqual(1600);
    }

    await expect(secureChunkStorage.getItem("sb-session")).resolves.toBe(session);
  });

  it("returns null and cleans up when a chunk went missing", async () => {
    await secureChunkStorage.setItem("sb-session", "y".repeat(5000));
    store.delete("sb-session.1");

    await expect(secureChunkStorage.getItem("sb-session")).resolves.toBeNull();
    expect(store.size).toBe(0);
  });

  it("does not leave orphan chunks when a long value is replaced by a short one", async () => {
    await secureChunkStorage.setItem("sb-session", "z".repeat(5000));
    await secureChunkStorage.setItem("sb-session", "corto");

    await expect(secureChunkStorage.getItem("sb-session")).resolves.toBe("corto");
    expect([...store.keys()].filter((key) => key.startsWith("sb-session."))).toHaveLength(2);
  });

  it("removes every chunk on logout", async () => {
    await secureChunkStorage.setItem("sb-session", "w".repeat(5000));
    await secureChunkStorage.removeItem("sb-session");

    await expect(secureChunkStorage.getItem("sb-session")).resolves.toBeNull();
    expect(store.size).toBe(0);
  });

  it("reads a legacy value stored without chunking", async () => {
    store.set("sb-session", "valor-viejo");

    await expect(secureChunkStorage.getItem("sb-session")).resolves.toBe("valor-viejo");
  });
});
