/**
 * INV-F1 · el `returnTo` encadenado se movió a `@/shared/utils/returnTo` (sus
 * tests están allí); este módulo lo sigue exponiendo a los importadores de inventario.
 */
import * as shared from "@/shared/utils/returnTo";

import { readChainedReturnTo, withChainedReturnTo } from "./chainedReturnTo";

describe("chainedReturnTo (reexportación)", () => {
  it("expone las mismas funciones que shared/utils/returnTo", () => {
    expect(readChainedReturnTo).toBe(shared.readChainedReturnTo);
    expect(withChainedReturnTo).toBe(shared.withChainedReturnTo);
  });

  it("el enlace al kardex conserva el returnTo con el que se llegó a /inventory", () => {
    const listUrl = `/inventory?product=p-cafe&returnTo=${encodeURIComponent("/products?page=2")}`;
    const href = withChainedReturnTo("/inventory/movements?productId=p-cafe", listUrl);

    expect(readChainedReturnTo(new URLSearchParams(href.split("?")[1]).get("returnTo"))).toBe(listUrl);
  });
});
