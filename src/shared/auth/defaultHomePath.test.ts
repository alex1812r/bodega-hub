import { describe, expect, it } from "@jest/globals";

import { getDefaultHomePathForRole } from "./defaultHomePath";

describe("getDefaultHomePathForRole", () => {
  it("sends vendedor to POS", () => {
    expect(getDefaultHomePathForRole("vendedor")).toBe("/sales/create");
  });

  it("sends other roles to dashboard", () => {
    expect(getDefaultHomePathForRole("admin")).toBe("/dashboard");
    expect(getDefaultHomePathForRole("almacen")).toBe("/dashboard");
    expect(getDefaultHomePathForRole("contador")).toBe("/dashboard");
  });
});
