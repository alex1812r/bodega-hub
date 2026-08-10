import { refToVes, roundMoney, vesToRef } from "./currency";

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
});
