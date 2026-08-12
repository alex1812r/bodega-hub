import { amountWithTax, refToVes, roundMoney, vesToRef } from "./currency";

describe("currency", () => {
  it("converts ref to ves", () => {
    expect(refToVes(2, 500)).toBe(1000);
  });

  it("converts ves to ref", () => {
    expect(roundMoney(vesToRef(1500, 756.71))).toBe(1.98);
  });

  it("rounds money to 2 decimals", () => {
    expect(roundMoney(1.985)).toBe(1.99);
    expect(roundMoney(1.984)).toBe(1.98);
  });

  it("applies tax rate on top of net amount", () => {
    expect(amountWithTax(100, 16)).toBe(116);
    expect(amountWithTax(10, 0)).toBe(10);
    expect(amountWithTax(1.5, 16)).toBe(1.74);
  });
});
