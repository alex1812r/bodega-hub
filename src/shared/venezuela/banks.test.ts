import {
  filterBanks,
  findBankByCode,
  findBankByLabel,
  formatBankLabel,
  isKnownBankLabel,
} from "./banks";

describe("venezuela banks", () => {
  it("formats canonical bank labels", () => {
    expect(formatBankLabel("0134", "Banesco")).toBe("0134 - Banesco");
  });

  it("finds banks by code or label", () => {
    expect(findBankByCode("0134")?.name).toBe("Banesco");
    expect(findBankByLabel("0134 - Banesco")?.code).toBe("0134");
    expect(findBankByLabel("banesco")?.code).toBe("0134");
    expect(isKnownBankLabel("0134 - Banesco")).toBe(true);
    expect(isKnownBankLabel("Banco Inventado")).toBe(false);
  });

  it("filters banks by code or name", () => {
    expect(filterBanks("0134").map((bank) => bank.code)).toEqual(["0134"]);
    expect(filterBanks("provincial").some((bank) => bank.code === "0108")).toBe(
      true,
    );
    expect(filterBanks("").length).toBeGreaterThan(20);
  });
});
