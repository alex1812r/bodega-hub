import { parseProductImageUploadOptions } from "./productImageUploadOptions";

describe("parseProductImageUploadOptions", () => {
  it("defaults to webp", () => {
    expect(parseProductImageUploadOptions(undefined)).toEqual({ format: "webp" });
  });

  it("accepts png format", () => {
    expect(parseProductImageUploadOptions({ format: "png" })).toEqual({ format: "png" });
  });
});
