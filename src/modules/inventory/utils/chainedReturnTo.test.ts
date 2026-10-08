/**
 * INV-F1 · `returnTo` encadenado de `/inventory`: el enlace al kardex completo
 * lleva la URL de la lista con el `returnTo` con el que se llegó a ella, y
 * "Volver" del kardex la respeta entera.
 */
import { readChainedReturnTo, withChainedReturnTo } from "./chainedReturnTo";

const PRODUCTS_URL = "/products?search=caf&page=2";
const LIST_URL = `/inventory?product=p-cafe&returnTo=${encodeURIComponent(PRODUCTS_URL)}`;

describe("withChainedReturnTo", () => {
  it("keeps the returnTo of the list nested inside the new returnTo", () => {
    const href = withChainedReturnTo("/inventory/movements?productId=p-cafe", LIST_URL);
    const params = new URLSearchParams(href.split("?")[1]);

    expect(href.split("?")[0]).toBe("/inventory/movements");
    expect(params.get("productId")).toBe("p-cafe");
    expect(params.get("returnTo")).toBe(LIST_URL);
    expect(new URLSearchParams(LIST_URL.split("?")[1]).get("returnTo")).toBe(PRODUCTS_URL);
  });

  it("gives the same link as before when the list has no returnTo", () => {
    expect(withChainedReturnTo("/inventory/movements?productId=p-cafe", "/inventory?product=p-cafe")).toBe(
      `/inventory/movements?productId=p-cafe&returnTo=${encodeURIComponent("/inventory?product=p-cafe")}`,
    );
  });

  it("drops a hostile nested returnTo and keeps the list", () => {
    const href = withChainedReturnTo(
      "/inventory/movements?productId=p-cafe",
      "/inventory?product=p-cafe&returnTo=https%3A%2F%2Fevil.com",
    );

    expect(new URLSearchParams(href.split("?")[1]).get("returnTo")).toBe("/inventory?product=p-cafe");
  });

  it("leaves the link alone when the list URL is not an internal path", () => {
    expect(withChainedReturnTo("/inventory/movements", "https://evil.com/inventory")).toBe(
      "/inventory/movements",
    );
  });
});

describe("readChainedReturnTo", () => {
  it("returns a safe returnTo whole, with its nested returnTo", () => {
    expect(readChainedReturnTo(LIST_URL)).toBe(LIST_URL);
    expect(readChainedReturnTo("/products/p-arroz")).toBe("/products/p-arroz");
  });

  it.each([
    null,
    "",
    "//evil.com",
    "https://evil.com",
    "/api/inventory",
    "/inventory?returnTo=https%3A%2F%2Fevil.com",
  ])("returns null for %p", (value) => {
    expect(readChainedReturnTo(value)).toBeNull();
  });
});
