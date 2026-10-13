/**
 * @jest-environment node
 */

import { buildGeneratedSku } from "./productSku";

describe("buildGeneratedSku", () => {
  it("derives the first candidate from the name, without accents or ñ", () => {
    expect(buildGeneratedSku("Harina PAN 1kg", 0)).toBe("hari-pan-1kg");
    expect(buildGeneratedSku("Piñón Añejo Café", 0)).toBe("pino-anej-cafe");
  });

  it.each(["🍕🍕", "***", "---", "   ", ""])(
    "falls back to a valid sku when the name [%s] has no letters or digits",
    (name) => {
      expect(buildGeneratedSku(name, 0)).toBe("producto");
      expect(buildGeneratedSku(name, 1)).toMatch(/^producto-[0-9a-f]{4}$/);
    },
  );

  it("adds a random suffix that changes between retries", () => {
    const candidates = new Set(
      Array.from({ length: 20 }, (_, index) => buildGeneratedSku("Harina PAN 1kg", index + 1)),
    );

    expect([...candidates].every((sku) => /^hari-pan-1kg-[0-9a-f]{4}$/.test(sku))).toBe(true);
    expect(candidates.size).toBeGreaterThan(1);
  });

  it("keeps the suffixed sku within 32 characters and without a double hyphen", () => {
    const sku = buildGeneratedSku("Aceite Capri Oliva Extra Virgen Botella Grande Familiar", 2);

    expect(sku.length).toBeLessThanOrEqual(32);
    expect(sku).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
