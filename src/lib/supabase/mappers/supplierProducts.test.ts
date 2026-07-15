import { computeVariationPercent } from "@/lib/supabase/mappers/supplierProducts";

describe("supplierProducts mapper", () => {
  it("computes variation percent when previous cost is positive", () => {
    expect(computeVariationPercent(8, 8.5)).toBe(6.25);
  });

  it("returns null when previous cost is zero or missing", () => {
    expect(computeVariationPercent(undefined, 8.5)).toBeNull();
    expect(computeVariationPercent(0, 8.5)).toBeNull();
  });
});
