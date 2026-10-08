/**
 * @jest-environment node
 */
/**
 * COM-F5: los mocks de inventario, productos, revisión de precios y compras no
 * forman un ciclo de imports. Con el ciclo, un mock parcial
 * (`{ ...jest.requireActual(modulo) }`) leía un módulo a medio cargar y fallaba
 * con «Cannot access '_productsmockserver' before initialization».
 */

const INVENTORY = "../../inventory/services/inventory.mock-server";
const PRODUCTS = "../../products/services/products.mock-server";
const PRICE_REVIEW = "../../products/services/priceReview.mock-server";
const PURCHASES = "./purchases.mock-server";

const USED_EXPORTS: Record<string, string[]> = {
  [INVENTORY]: ["convertPackToUnits", "createStockAdjustment", "listPackConversions"],
  [PRICE_REVIEW]: ["applyMockPurchaseCost"],
  [PRODUCTS]: ["listPackConversions"],
  [PURCHASES]: ["createPurchase", "findMockPurchase", "receivePurchase"],
};

const LOAD_ORDERS = [
  [INVENTORY, PRODUCTS, PRICE_REVIEW, PURCHASES],
  [PURCHASES, PRICE_REVIEW, PRODUCTS, INVENTORY],
  [PRODUCTS, PURCHASES, INVENTORY, PRICE_REVIEW],
  [PRICE_REVIEW, INVENTORY, PURCHASES, PRODUCTS],
];

function expectUsedExports(path: string, loaded: Record<string, unknown>) {
  for (const name of USED_EXPORTS[path] ?? []) {
    expect({ name, path, type: typeof loaded[name] }).toEqual({ name, path, type: "function" });
  }
}

describe("mock-servers de inventario, productos, revisión de precios y compras", () => {
  it.each(LOAD_ORDERS)("cargan empezando por %s", (...order: string[]) => {
    jest.isolateModules(() => {
      for (const path of order) {
        expectUsedExports(path, jest.requireActual<Record<string, unknown>>(path));
      }
    });
  });

  it.each([INVENTORY, PRODUCTS, PRICE_REVIEW, PURCHASES])(
    "admite un mock parcial de %s cargado antes que los demás",
    (mocked: string) => {
      jest.isolateModules(() => {
        jest.doMock(mocked, () => ({ ...jest.requireActual<Record<string, unknown>>(mocked) }));

        try {
          expectUsedExports(mocked, jest.requireMock<Record<string, unknown>>(mocked));

          for (const path of [INVENTORY, PRODUCTS, PRICE_REVIEW, PURCHASES]) {
            expectUsedExports(path, jest.requireActual<Record<string, unknown>>(path));
          }
        } finally {
          jest.dontMock(mocked);
        }
      });
    },
  );
});
