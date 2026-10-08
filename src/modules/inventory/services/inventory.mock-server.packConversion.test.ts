/**
 * @jest-environment node
 */
/**
 * PRO-12 · apertura de un empaque con receta de N componentes en el mock, con el
 * reparto de costo de `convert_pack_to_units` (parche 20261009d): valor = empaques
 * x costo del empaque; parte de cada componente proporcional a unidades x peso
 * (4 decimales); el residuo al de mayor unidades x peso (empate: mayor id).
 */

import { buildMockPackRecipe } from "@/modules/products/services/packConversionSummary";
import {
  mockProductPackConversions,
  mockProducts,
  mockStockMovements,
  type ProductPackComponentMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { convertPackToUnits } from "./inventory.mock-server";

let sequence = 0;

type ComponentSeed = { cost?: number; stock?: number; units: number; weight?: number };

/** Empaque nuevo con su receta; los ids de los componentes van en orden (a < b < c). */
function seedRecipe(options: { components: ComponentSeed[]; packCost: number; packStock?: number }) {
  sequence += 1;
  const prefix = `cx${String(sequence).padStart(2, "0")}`;
  const packId = `${prefix}-pack`;

  mockProducts.push({
    categoryId: "cat-tools",
    currentCostRef: options.packCost,
    currentStock: options.packStock ?? 5,
    id: packId,
    isActive: true,
    minStock: 0,
    name: `Empaque ${prefix}`,
    salePriceRef: 20,
    sku: `${prefix}-pack`,
    storeId: DEFAULT_STORE_ID,
  });

  const components: ProductPackComponentMock[] = options.components.map((component, index) => {
    const id = `${prefix}-${"abcdef"[index]}`;

    mockProducts.push({
      categoryId: "cat-tools",
      currentCostRef: component.cost ?? 0,
      currentStock: component.stock ?? 0,
      id,
      isActive: true,
      minStock: 0,
      name: `Componente ${id}`,
      salePriceRef: 3,
      sku: id,
      storeId: DEFAULT_STORE_ID,
    });

    return { costWeight: component.weight ?? 1, unitProductId: id, unitsPerPack: component.units };
  });

  mockProductPackConversions.push(
    buildMockPackRecipe({
      components,
      id: `${prefix}-recipe`,
      isActive: true,
      packProductId: packId,
      storeId: DEFAULT_STORE_ID,
      totalUnits: components.reduce((total, component) => total + component.unitsPerPack, 0),
    }),
  );

  return { ids: components.map((component) => component.unitProductId), packId };
}

function productOf(id: string) {
  const product = mockProducts.find((item) => item.id === id);

  if (!product) {
    throw new Error(`Producto ${id} no sembrado`);
  }

  return product;
}

function stocks(ids: string[]) {
  return ids.map((id) => productOf(id).currentStock);
}

/** Suma en diezmilesimas, para comparar al centimo sin ruido de coma flotante. */
function totalE4(values: number[]) {
  return values.reduce((total, value) => total + Math.round(value * 10000), 0);
}

describe("inventory.mock-server · apertura de un empaque surtido", () => {
  it("receta 2-2-2 sin reparto: 1 salida + 3 entradas con el mismo conversionId y el valor repartido a partes iguales", () => {
    const { ids, packId } = seedRecipe({
      components: [{ units: 2 }, { units: 2 }, { units: 2 }],
      packCost: 12,
    });
    const movementsBefore = mockStockMovements.length;

    const result = convertPackToUnits({ packProductId: packId, packQuantity: 1 }, DEFAULT_STORE_ID);

    expect(result).toMatchObject({
      packQuantity: 1,
      totalUnits: 6,
      unitCostRef: 2,
      unitQuantity: 6,
      unitsPerPack: 6,
    });
    expect(result.components.map((component) => [component.unitProductId, component.units])).toEqual([
      [ids[0], 2],
      [ids[1], 2],
      [ids[2], 2],
    ]);
    expect(result.components.map((component) => component.allocatedValueRef)).toEqual([4, 4, 4]);
    expect(result.components.map((component) => component.newCostRef)).toEqual([2, 2, 2]);
    expect(result.components.every((component) => component.isActive)).toBe(true);

    expect(productOf(packId).currentStock).toBe(4);
    expect(stocks(ids)).toEqual([2, 2, 2]);
    expect(ids.map((id) => productOf(id).currentCostRef)).toEqual([2, 2, 2]);

    expect(mockStockMovements.length).toBe(movementsBefore + 4);
    expect(result.packMovement).toMatchObject({
      conversionId: result.conversionId,
      productId: packId,
      quantityDelta: -1,
      stockAfter: 4,
      type: "conversion_salida",
    });
    expect(result.components.map((component) => component.movement)).toEqual(
      ids.map((id) =>
        expect.objectContaining({
          conversionId: result.conversionId,
          productId: id,
          quantityDelta: 2,
          stockAfter: 2,
          type: "conversion_entrada",
        }),
      ),
    );
    // La entrada del primer componente por id, como la RPC.
    expect(result.unitMovement).toBe(result.components[0].movement);
    expect(new Set(result.components.map((component) => component.movement.id)).size).toBe(3);
  });

  it("reparto real 3-1-2: cada componente recibe lo enviado y el costo sigue a las unidades", () => {
    const { ids, packId } = seedRecipe({
      components: [{ cost: 2, stock: 3, units: 2 }, { units: 2 }, { units: 2 }],
      packCost: 10,
    });

    const result = convertPackToUnits(
      {
        components: [
          { unitProductId: ids[2], units: 2 },
          { unitProductId: ids[0], units: 3 },
          { unitProductId: ids[1], units: 1 },
        ],
        packProductId: packId,
        packQuantity: 1,
      },
      DEFAULT_STORE_ID,
    );

    expect(stocks(ids)).toEqual([6, 1, 2]);
    // 10 x 1/6 = 1,6667 y 10 x 2/6 = 3,3333; el residuo (5,0000) va al de mas unidades x peso.
    expect(result.components.map((component) => component.allocatedValueRef)).toEqual([5, 1.6667, 3.3333]);
    expect(totalE4(result.components.map((component) => component.allocatedValueRef))).toBe(100000);
    expect(result.components.map((component) => component.unitCostRef)).toEqual([1.67, 1.67, 1.67]);
    // Con stock previo, promedio ponderado: (3 x 2,00 + 5,0000) / 6 = 1,83.
    expect(result.components.map((component) => component.newCostRef)).toEqual([1.83, 1.67, 1.67]);
    expect(ids.map((id) => productOf(id).currentCostRef)).toEqual([1.83, 1.67, 1.67]);
    expect(result.unitQuantity).toBe(6);
  });

  it("un componente con 0 unidades no deja movimiento ni cambia de costo", () => {
    const { ids, packId } = seedRecipe({
      components: [{ units: 2 }, { cost: 9, stock: 1, units: 2 }, { units: 2 }],
      packCost: 12,
    });
    const movementsBefore = mockStockMovements.length;

    const result = convertPackToUnits(
      {
        components: [
          { unitProductId: ids[0], units: 6 },
          { unitProductId: ids[1], units: 0 },
        ],
        packProductId: packId,
        packQuantity: 1,
      },
      DEFAULT_STORE_ID,
    );

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({ allocatedValueRef: 12, unitProductId: ids[0], units: 6 });
    expect(stocks(ids)).toEqual([6, 1, 0]);
    expect(productOf(ids[1]).currentCostRef).toBe(9);
    expect(mockStockMovements.length).toBe(movementsBefore + 2);
  });

  it.each([
    ["suma de menos", [3, 1, 1]],
    ["suma de mas", [3, 2, 2]],
  ])("reparto con %s: 400 y no se mueve nada", (_caso, units) => {
    const { ids, packId } = seedRecipe({
      components: [{ units: 2 }, { units: 2 }, { units: 2 }],
      packCost: 12,
    });
    const movementsBefore = mockStockMovements.length;

    expect(() =>
      convertPackToUnits(
        {
          components: ids.map((id, index) => ({ unitProductId: id, units: units[index] })),
          packProductId: packId,
          packQuantity: 1,
        },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining("debe sumar 6 unidades"), status: 400 }));

    expect(productOf(packId).currentStock).toBe(5);
    expect(stocks(ids)).toEqual([0, 0, 0]);
    expect(mockStockMovements.length).toBe(movementsBefore);
  });

  it("el reparto debe sumar unidades de la receta x empaques, y solo admite sus componentes", () => {
    const { ids, packId } = seedRecipe({
      components: [{ units: 2 }, { units: 2 }, { units: 2 }],
      packCost: 12,
    });

    expect(() =>
      convertPackToUnits(
        { components: [{ unitProductId: ids[0], units: 6 }], packProductId: packId, packQuantity: 2 },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining("debe sumar 12 unidades"), status: 400 }));

    expect(() =>
      convertPackToUnits(
        { components: [{ unitProductId: "prod-cable", units: 6 }], packProductId: packId, packQuantity: 1 },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ status: 400 }));

    const result = convertPackToUnits(
      { components: [{ unitProductId: ids[0], units: 12 }], packProductId: packId, packQuantity: 2 },
      DEFAULT_STORE_ID,
    );

    expect(result.unitQuantity).toBe(12);
    expect(stocks(ids)).toEqual([12, 0, 0]);
  });

  it("pesos de costo distintos: la suma asignada es el valor transferido, al centimo", () => {
    const { ids, packId } = seedRecipe({
      components: [{ units: 2, weight: 1 }, { units: 2, weight: 2 }, { units: 2, weight: 3 }],
      packCost: 10.01,
    });

    const result = convertPackToUnits({ packProductId: packId, packQuantity: 3 }, DEFAULT_STORE_ID);

    // Valor 30,03; pesos 6, 12 y 18 de 36. El de mayor peso se queda con el residuo.
    expect(result.components.map((component) => component.allocatedValueRef)).toEqual([5.005, 10.01, 15.015]);
    expect(totalE4(result.components.map((component) => component.allocatedValueRef))).toBe(300300);
    expect(result.components.map((component) => component.costWeight)).toEqual([1, 2, 3]);
    expect(result.components.map((component) => component.unitCostRef)).toEqual([0.83, 1.67, 2.5]);
    expect(ids.map((id) => productOf(id).currentCostRef)).toEqual([0.83, 1.67, 2.5]);
    expect(result.unitCostRef).toBe(1.67);
  });

  it("el residuo del redondeo va al componente de mayor id cuando empatan en peso", () => {
    const { packId } = seedRecipe({
      components: [{ units: 1 }, { units: 1 }, { units: 1 }],
      packCost: 1,
    });

    const result = convertPackToUnits({ packProductId: packId, packQuantity: 1 }, DEFAULT_STORE_ID);

    expect(result.components.map((component) => component.allocatedValueRef)).toEqual([0.3333, 0.3333, 0.3334]);
    expect(totalE4(result.components.map((component) => component.allocatedValueRef))).toBe(10000);
  });

  it("idempotencia con reparto: la misma clave y el mismo reparto devuelven la conversion original; otro reparto, 409", () => {
    const { ids, packId } = seedRecipe({
      components: [{ units: 2 }, { units: 2 }, { units: 2 }],
      packCost: 12,
    });
    const clientRequestId = "5d0c8a0e-6f1b-4c3a-9a51-1f2e3d4c5b6a";
    const input = {
      clientRequestId,
      components: [
        { unitProductId: ids[0], units: 3 },
        { unitProductId: ids[1], units: 1 },
        { unitProductId: ids[2], units: 2 },
      ],
      packProductId: packId,
      packQuantity: 1,
    };
    const movementsBefore = mockStockMovements.length;

    const first = convertPackToUnits(input, DEFAULT_STORE_ID);
    const second = convertPackToUnits({ ...input, components: [...input.components] }, DEFAULT_STORE_ID);

    expect(second).toBe(first);
    expect(productOf(packId).currentStock).toBe(4);
    expect(stocks(ids)).toEqual([3, 1, 2]);
    expect(mockStockMovements.length).toBe(movementsBefore + 4);

    expect(() =>
      convertPackToUnits(
        { ...input, components: [{ unitProductId: ids[0], units: 6 }] },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(() =>
      convertPackToUnits({ clientRequestId, packProductId: packId, packQuantity: 1 }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(productOf(packId).currentStock).toBe(4);
  });
});

describe("inventory.mock-server · un componente: comportamiento de siempre", () => {
  it("el par sembrado (caja de cigarros x10) da los mismos valores que antes del surtido", () => {
    const pack = productOf("prod-cigar-pack");
    const unit = productOf("prod-cigar-unit");
    const before = { pack: pack.currentStock, unit: unit.currentStock, unitCost: unit.currentCostRef };
    // La formula del mock anterior al surtido, tal cual.
    const transferredValue = 2 * pack.currentCostRef;
    const expectedUnitCost = Number((transferredValue / 20).toFixed(2));
    const expectedNewCost = Number(
      ((before.unit * before.unitCost + transferredValue) / (before.unit + 20)).toFixed(2),
    );
    const movementsBefore = mockStockMovements.length;

    const result = convertPackToUnits(
      { packProductId: "prod-cigar-pack", packQuantity: 2, reason: "Abrir cajas" },
      DEFAULT_STORE_ID,
    );

    expect(result).toMatchObject({
      packQuantity: 2,
      unitCostRef: expectedUnitCost,
      unitQuantity: 20,
      unitsPerPack: 10,
    });
    expect(result.packMovement).toEqual({
      conversionId: result.conversionId,
      createdAt: result.packMovement.createdAt,
      id: result.packMovement.id,
      productId: "prod-cigar-pack",
      quantityDelta: -2,
      reason: "Abrir cajas",
      stockAfter: before.pack - 2,
      storeId: DEFAULT_STORE_ID,
      type: "conversion_salida",
    });
    expect(result.unitMovement).toEqual({
      conversionId: result.conversionId,
      createdAt: result.packMovement.createdAt,
      id: result.unitMovement.id,
      productId: "prod-cigar-unit",
      quantityDelta: 20,
      reason: "Abrir cajas",
      stockAfter: before.unit + 20,
      storeId: DEFAULT_STORE_ID,
      type: "conversion_entrada",
    });
    expect(result.packMovement.id).toMatch(/^mov-pack-\d+$/);
    expect(result.unitMovement.id).toMatch(/^mov-unit-\d+$/);
    expect(result.conversionId).toMatch(/^conv-mock-\d+$/);
    expect(pack.currentStock).toBe(before.pack - 2);
    expect(unit.currentStock).toBe(before.unit + 20);
    expect(unit.currentCostRef).toBe(expectedNewCost);
    // La entrada queda primero y la salida despues, como siempre.
    expect(mockStockMovements.length).toBe(movementsBefore + 2);
    expect(mockStockMovements.slice(0, 2)).toEqual([result.unitMovement, result.packMovement]);
    // Lo nuevo es aditivo.
    expect(result.totalUnits).toBe(10);
    expect(result.components).toEqual([
      {
        allocatedValueRef: transferredValue,
        costWeight: 1,
        isActive: true,
        movement: result.unitMovement,
        newCostRef: expectedNewCost,
        unitCostRef: expectedUnitCost,
        unitProductId: "prod-cigar-unit",
        units: 20,
      },
    ]);
  });

  it("promedio ponderado con stock previo: igual que la formula anterior", () => {
    const { ids, packId } = seedRecipe({ components: [{ cost: 1, stock: 3, units: 10 }], packCost: 12.5 });

    const result = convertPackToUnits({ packProductId: packId, packQuantity: 1 }, DEFAULT_STORE_ID);

    expect(result.unitCostRef).toBe(Number((12.5 / 10).toFixed(2)));
    expect(productOf(ids[0]).currentCostRef).toBe(Number(((3 * 1 + 12.5) / 13).toFixed(2)));
    expect(productOf(ids[0]).currentStock).toBe(13);
  });

  it("los rechazos de siempre conservan su codigo: sin receta, cantidad 0 y stock insuficiente → 400", () => {
    const { packId } = seedRecipe({ components: [{ units: 10 }], packCost: 5, packStock: 1 });

    expect(() =>
      convertPackToUnits({ packProductId: "prod-cable", packQuantity: 1 }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      convertPackToUnits({ packProductId: packId, packQuantity: 0 }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      convertPackToUnits({ packProductId: packId, packQuantity: 2 }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ message: "Stock insuficiente de empaque.", status: 400 }));
  });
});
