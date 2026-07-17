import {
  composeVeMobilePhone,
  formatSubscriberMask,
  formatVeMobilePhoneDisplay,
  isValidVeMobilePhone,
  parseVeMobilePhone,
} from "./phone";

describe("venezuela phone", () => {
  it("composes and formats national mobile numbers", () => {
    expect(composeVeMobilePhone("0412", "5551234")).toBe("04125551234");
    expect(formatSubscriberMask("5551234")).toBe("555-1234");
    expect(formatVeMobilePhoneDisplay("04125551234")).toBe("0412 555-1234");
  });

  it("parses valid mobile phones", () => {
    expect(parseVeMobilePhone("0412 555-1234")).toEqual({
      ok: true,
      value: { prefix: "0412", subscriber: "5551234" },
    });
    expect(isValidVeMobilePhone("04245551234")).toBe(true);
  });

  it("rejects invalid prefixes and lengths", () => {
    expect(parseVeMobilePhone("04115551234").ok).toBe(false);
    expect(parseVeMobilePhone("041255512").ok).toBe(false);
    expect(parseVeMobilePhone("").ok).toBe(false);
  });
});
