/**
 * @jest-environment node
 */
/**
 * COM-14 · «Desarmar al recibir» en el mock, en paridad con `create_purchase` y
 * `receive_purchase_and_disassemble` (parche 20261010d): la línea marcada de un
 * empaque con receta se abre al recibir; el empaque queda con stock neto 0 y los
 * componentes suben con el mismo costo que al abrirlo a mano.
 */

import { ApiError } from "@/lib/api/apiError";
import {
  convertPackToUnits,
  createStockAdjustment,
} from "@/modules/inventory/services/inventory.mock-server";
import {
  mockProductPackConversions,
  mockProducts,
  mockStockMovements,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { createPurchase, getPurchaseById, receivePurchase } from "./purchases.mock-server";

const KEY_A = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const KEY_B = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

const base = { discountRef: 0, refRateVes: 100, supplierId: "cont-supplier", taxRef: 0 };

let sequence = 0;

type ComponentSeed = { cost?: number; stock?: number; units: number; weight?: number };

function addProduct(id: string, name: string, cost: number, stock: number) {
  mockProducts.push({
    categoryId: "cat-tools",
    currentCostRef: cost,
    currentStock: stock,
    id,
    isActive: true,
    minStock: 0,
    name,
    salePriceRef: 20,
    sku: id,
    storeId: DEFAULT_STORE_ID,
  });
}

/** Empaque sin stock con su receta activa; los componentes van en orden de id (a < b < c). */
function seedPack(components: ComponentSeed[], options: { withRecipe?: boolean } = {}) {
  sequence += 1;
  const prefix = `dz${String(sequence).padStart(2, "0")}`;
  const packId = `${prefix}-pack`;
  const unitIds = components.map((_, index) => `${prefix}-${"abc"[index]}`);

  addProduct(packId, `Empaque ${prefix}`, 1, 0);
  components.forEach((component, index) =>
    addProduct(unitIds[index], `Componente ${prefix} ${"abc"[index]}`, component.cost ?? 0, component.stock ?? 0),
  );

  const totalUnits = components.reduce((total, component) => total + component.units, 0);
  const recipe = {
    components: components.map((component, index) => ({
      costWeight: component.weight ?? 1,
      unitProductId: unitIds[index],
      unitsPerPack: component.units,
    })),
    id: `${prefix}-recipe`,
    isActive: options.withRecipe ?? true,
    packProductId: packId,
    storeId: DEFAULT_STORE_ID,
    totalUnits,
    unitProductId: components.length === 1 ? unitIds[0] : null,
    unitsPerPack: totalUnits,
  };

  mockProductPackConversions.push(recipe);

  return { packId, recipe, unitIds };
}

function packLine(productId: string, quantity: number, costRef: number, marked?: boolean): PurchaseItemInput {
  return {
    costCurrency: "ref",
    ...(marked === undefined ? {} : { disassembleOnReceive: marked }),
    entryMode: "unit",
    productId,
    quantity,
    subtotalRef: quantity * costRef,
    subtotalVes: quantity * costRef * 100,
    taxRateCode: "exento",
    taxRef: 0,
    taxVes: 0,
    unitCostRef: costRef,
    unitCostVes: costRef * 100,
  };
}

function productOf(id: string) {
  const product = mockProducts.find((item) => item.id === id);

  if (!product) {
    throw new Error(`Producto de prueba ausente: ${id}`);
  }

  return product;
}

const stockOf = (ids: string[]) => ids.map((id) => productOf(id).currentStock);

/** Entrada de empaques por la función de movimiento del mock (el stock no se escribe a mano). */
function enterPacks(productId: string, quantity: number) {
  createStockAdjustment({ productId, quantityDelta: quantity, type: "ajuste_entrada" }, DEFAULT_STORE_ID);
}
const costOf = (ids: string[]) => ids.map((id) => productOf(id).currentCostRef);

function movementsOf(productId: string) {
  return mockStockMovements
    .filter((movement) => movement.productId === productId)
    .map((movement) => [movement.type, movement.quantityDelta])
    .reverse();
}

function expectApiError(run: () => unknown, status: number, message: string) {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect({ message: (thrown as ApiError).message, status: (thrown as ApiError).status }).toEqual({
    message,
    status,
  });
}

describe("purchases.mock-server · compra que nace recibida con línea marcada (COM-14)", () => {
  it("el empaque entra y sale (neto 0) y la unidad sube empaques × unidades, con el costo de abrirlo a mano", () => {
    const auto = seedPack([{ cost: 1, stock: 4, units: 6 }]);
    const manual = seedPack([{ cost: 1, stock: 4, units: 6 }]);

    const purchase = createPurchase(
      { ...base, items: [packLine(auto.packId, 3, 9, true)], subtotalRef: 27 },
      DEFAULT_STORE_ID,
    );
    createPurchase({ ...base, items: [packLine(manual.packId, 3, 9)], subtotalRef: 27 }, DEFAULT_STORE_ID);
    enterPacks(manual.packId, 3);
    convertPackToUnits({ packProductId: manual.packId, packQuantity: 3 }, DEFAULT_STORE_ID);

    // 3 empaques a 9,00 = 27,00 sobre 18 unidades; con las 4 que había a 1,00: (4 + 27) / 22 = 1,41.
    expect(stockOf([auto.packId, ...auto.unitIds])).toEqual([0, 22]);
    expect(costOf([auto.packId, ...auto.unitIds])).toEqual([9, 1.41]);
    expect(costOf(auto.unitIds)).toEqual(costOf(manual.unitIds));
    expect(stockOf(auto.unitIds)).toEqual(stockOf(manual.unitIds));
    expect(movementsOf(auto.packId)).toEqual([
      ["compra", 3],
      ["conversion_salida", -3],
    ]);
    expect(movementsOf(auto.unitIds[0])).toEqual([["conversion_entrada", 18]]);
    expect(getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0]).toMatchObject({
      disassembled: true,
      disassembleOnReceive: true,
    });
  });

  it("sin marca (o con false) la compra es la de siempre: el mock no mueve stock ni abre nada", () => {
    const pack = seedPack([{ units: 6 }]);

    const absent = createPurchase({ ...base, items: [packLine(pack.packId, 3, 9)], subtotalRef: 27 }, DEFAULT_STORE_ID);
    const explicit = createPurchase(
      { ...base, items: [packLine(pack.packId, 3, 9, false)], subtotalRef: 27 },
      DEFAULT_STORE_ID,
    );

    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 0]);
    expect(movementsOf(pack.packId)).toEqual([]);
    expect(
      [absent, explicit].map((purchase) => getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0]),
    ).toEqual([
      expect.objectContaining({ disassembled: false, disassembleOnReceive: false }),
      expect.objectContaining({ disassembled: false, disassembleOnReceive: false }),
    ]);
  });

  it.each(["recibido", "pedido"] as const)(
    "compra %s con una línea marcada sin receta activa: 400 con el texto de la base y nada creado ni movido",
    (status) => {
      const pack = seedPack([{ units: 6 }], { withRecipe: false });

      expectApiError(
        () =>
          createPurchase(
            { ...base, clientRequestId: KEY_A, items: [packLine(pack.packId, 3, 9, true)], status, subtotalRef: 27 },
            DEFAULT_STORE_ID,
          ),
        400,
        `Sin receta de apertura activa: ${productOf(pack.packId).name}. No se puede marcar «Desarmar al recibir» en esas líneas`,
      );
      expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 0]);
      expect(costOf([pack.packId])).toEqual([1]);
    },
  );

  it("reintento con la misma clave: la compra original y ni un movimiento más", () => {
    const pack = seedPack([{ units: 6 }]);
    const input = { ...base, clientRequestId: KEY_B, items: [packLine(pack.packId, 2, 6, true)], subtotalRef: 12 };

    const first = createPurchase(input, DEFAULT_STORE_ID);
    const second = createPurchase(input, DEFAULT_STORE_ID);

    expect(second).toBe(first);
    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 12]);
    expect(movementsOf(pack.unitIds[0])).toHaveLength(1);
  });
});

describe("purchases.mock-server · recibir un pedido con línea marcada (COM-14)", () => {
  function order(items: PurchaseItemInput[]) {
    return createPurchase({ ...base, items, status: "pedido", subtotalRef: 0 }, DEFAULT_STORE_ID);
  }

  it("el pedido guarda la marca y trae la receta para previsualizar; recibir abre los empaques", () => {
    const pack = seedPack([{ stock: 5, units: 6 }]);
    const purchase = order([packLine(pack.packId, 2, 6, true)]);
    const pending = getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0];

    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 5]);
    expect(pending).toMatchObject({
      disassembled: false,
      disassembleOnReceive: true,
      packRecipe: {
        components: [{ currentStock: 5, unitProductId: pack.unitIds[0], unitsPerPack: 6 }],
        conversionId: pack.recipe.id,
        totalUnits: 6,
      },
    });

    const received = receivePurchase(purchase.id, DEFAULT_STORE_ID);

    expect(received.status).toBe("recibido");
    expect(received.items[0]).toMatchObject({ disassembled: true, disassembleOnReceive: true });
    expect(received.items[0]).not.toHaveProperty("packRecipe");
    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 17]);
  });

  it("surtido con reparto ajustado: entra lo enviado, con el costo de abrirlo a mano con ese reparto", () => {
    const seed: ComponentSeed[] = [{ cost: 0.9, stock: 7, units: 5 }, { units: 4, weight: 1.5 }, { cost: 2, stock: 2, units: 3, weight: 2 }];
    const auto = seedPack(seed);
    const manual = seedPack(seed);
    const share = (ids: string[]) => [
      { unitProductId: ids[0], units: 10 },
      { unitProductId: ids[1], units: 0 },
      { unitProductId: ids[2], units: 14 },
    ];
    const purchase = order([packLine(auto.packId, 2, 10, true)]);
    const itemId = getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0].id;

    receivePurchase(purchase.id, DEFAULT_STORE_ID, {
      disassemble: [{ distribution: share(auto.unitIds), purchaseItemId: itemId }],
    });
    productOf(manual.packId).currentCostRef = 10;
    enterPacks(manual.packId, 2);
    convertPackToUnits(
      { components: share(manual.unitIds), packProductId: manual.packId, packQuantity: 2 },
      DEFAULT_STORE_ID,
    );

    expect(stockOf([auto.packId, ...auto.unitIds])).toEqual([0, 17, 0, 16]);
    expect(costOf(auto.unitIds)).toEqual(costOf(manual.unitIds));
  });

  it("un reparto que no suma: 400 y NADA recibido (compra en pedido, sin costo ni stock movidos)", () => {
    const pack = seedPack([{ units: 3 }, { units: 3 }]);
    const purchase = order([packLine(pack.packId, 2, 10, true)]);
    const itemId = getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0].id;

    expectApiError(
      () =>
        receivePurchase(purchase.id, DEFAULT_STORE_ID, {
          disassemble: [{ distribution: [{ unitProductId: pack.unitIds[0], units: 5 }], purchaseItemId: itemId }],
        }),
      400,
      "El reparto debe sumar 12 unidades (2 empaques × 6) y suma 5.",
    );
    expect(getPurchaseById(purchase.id, DEFAULT_STORE_ID).status).toBe("pedido");
    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 0, 0]);
    expect(costOf([pack.packId])).toEqual([1]);
  });

  it("la lista manda sobre la marca: [] no desarma; una línea sin marca incluida en la lista sí", () => {
    const [first, second] = [seedPack([{ units: 6 }]), seedPack([{ units: 8 }])];
    const none = order([packLine(first.packId, 1, 6, true)]);
    const swapped = order([packLine(first.packId, 1, 6, true), packLine(second.packId, 2, 8)]);

    const untouched = receivePurchase(none.id, DEFAULT_STORE_ID, { disassemble: [] });

    expect(untouched.items[0]).toMatchObject({ disassembled: false, disassembleOnReceive: false });
    expect(stockOf([first.packId, ...first.unitIds])).toEqual([0, 0]);

    const items = getPurchaseById(swapped.id, DEFAULT_STORE_ID).items;
    const received = receivePurchase(swapped.id, DEFAULT_STORE_ID, {
      disassemble: [{ purchaseItemId: items[1].id }],
    });

    expect(received.items.map((item) => [item.disassembleOnReceive, item.disassembled])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(stockOf([first.packId, ...first.unitIds, second.packId, ...second.unitIds])).toEqual([0, 0, 0, 16]);
  });

  it("lista con una línea repetida o de otra compra: 400 y nada recibido", () => {
    const pack = seedPack([{ units: 6 }]);
    const purchase = order([packLine(pack.packId, 1, 6, true)]);
    const itemId = getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0].id;

    expectApiError(
      () => receivePurchase(purchase.id, DEFAULT_STORE_ID, { disassemble: [{ purchaseItemId: itemId }, { purchaseItemId: itemId }] }),
      400,
      "La lista de lineas a desarmar repite una linea",
    );
    expectApiError(
      () => receivePurchase(purchase.id, DEFAULT_STORE_ID, { disassemble: [{ purchaseItemId: "otra:item-0" }] }),
      400,
      "Una linea a desarmar no pertenece a la compra",
    );
    expect(getPurchaseById(purchase.id, DEFAULT_STORE_ID).status).toBe("pedido");
  });

  it("receta desactivada entre el pedido y la recepción: 409 con el texto de la base y nada recibido; desmarcando la línea, entra", () => {
    const pack = seedPack([{ units: 6 }]);
    const purchase = order([packLine(pack.packId, 2, 6, true)]);

    pack.recipe.isActive = false;

    expectApiError(
      () => receivePurchase(purchase.id, DEFAULT_STORE_ID),
      409,
      `Sin receta de apertura activa: ${productOf(pack.packId).name}. Desmarca «Desarmar al recibir» en esas líneas o activa su receta`,
    );
    expect(getPurchaseById(purchase.id, DEFAULT_STORE_ID).status).toBe("pedido");
    expect(costOf([pack.packId])).toEqual([1]);

    const received = receivePurchase(purchase.id, DEFAULT_STORE_ID, { disassemble: [] });

    expect(received.status).toBe("recibido");
    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 0]);
  });

  it("reintento con la misma clave devuelve la compra recibida; otra lista con esa clave es 409; recibir de nuevo, 400: nunca se desarma dos veces", () => {
    const pack = seedPack([{ units: 6 }]);
    const purchase = order([packLine(pack.packId, 2, 6, true)]);

    const first = receivePurchase(purchase.id, DEFAULT_STORE_ID, { clientRequestId: KEY_A });
    const retry = receivePurchase(purchase.id, DEFAULT_STORE_ID, { clientRequestId: KEY_A });

    expect([first.status, retry.status]).toEqual(["recibido", "recibido"]);
    expectApiError(
      () => receivePurchase(purchase.id, DEFAULT_STORE_ID, { clientRequestId: KEY_A, disassemble: [] }),
      409,
      "La clave de idempotencia ya se uso en otra recepcion de esta compra. Revisa la compra antes de reintentar.",
    );
    expectApiError(
      () => receivePurchase(purchase.id, DEFAULT_STORE_ID, { clientRequestId: KEY_B }),
      400,
      "Solo se pueden recibir compras en estado pedido.",
    );
    expectApiError(() => receivePurchase(purchase.id, DEFAULT_STORE_ID), 400, "Solo se pueden recibir compras en estado pedido.");
    expect(stockOf([pack.packId, ...pack.unitIds])).toEqual([0, 12]);
    expect(movementsOf(pack.unitIds[0])).toHaveLength(1);
  });
});
