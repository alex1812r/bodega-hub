import { describe, expect, it } from "@jest/globals";

import { packConversionInputSchema } from "./packConversionSchemas";

describe("packConversionInputSchema", () => {
  it("accepts disabled conversion", () => {
    expect(packConversionInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("requires unitsPerPack when enabled", () => {
    const result = packConversionInputSchema.safeParse({
      enabled: true,
      mode: "create_unit",
      unitProduct: { salePriceRef: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts create_unit mode", () => {
    const result = packConversionInputSchema.parse({
      enabled: true,
      mode: "create_unit",
      unitsPerPack: 10,
      unitProduct: { salePriceRef: 1.5, name: "Unidad" },
    });
    expect(result.enabled).toBe(true);
    expect(result.unitsPerPack).toBe(10);
  });

  it("requires unitProductId for link_existing", () => {
    const result = packConversionInputSchema.safeParse({
      enabled: true,
      mode: "link_existing",
      unitsPerPack: 6,
    });
    expect(result.success).toBe(false);
  });
});
