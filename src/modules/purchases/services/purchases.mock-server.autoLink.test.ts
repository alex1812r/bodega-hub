/**
 * @jest-environment node
 */
/**
 * COM-02 · vínculo automático proveedor–producto en modo mock, con las reglas de
 * `create_purchase` (parche 20261010a): cada línea queda vinculada al proveedor,
 * con su costo, su empaque y el habitual, sin duplicar; el proveedor inactivo o
 * que no es proveedor rechaza la compra y no crea nada.
 */

import {
  deactivateSupplierProduct,
  listProductSuppliers,
  listSupplierProductPriceHistory,
} from "@/modules/contacts/services/supplierProducts.mock-server";
import { createProduct } from "@/modules/products/services/products.mock-server";
import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { createPurchase, type PurchaseInput } from "./purchases.mock-server";

const SUPPLIER = "cont-supplier";
const OTHER_SUPPLIER = "cont-supplier-tools";
const RATE = 510;
/** Producto empaque del par activo de la semilla (`ppc-cigars`, 10 unidades). */
const PACK_PRODUCT = "prod-cigar-pack";

let seq = 0;

function newProduct() {
  seq += 1;

  return createProduct(
    { currentCostRef: 1, name: `Producto vínculo ${seq}`, salePriceRef: 10, sku: `link-${seq}` },
    DEFAULT_STORE_ID,
  ).id;
}

function unitLine(productId: string, unitCostRef: number, taxRateCode = "exento"): PurchaseItemInput {
  return {
    costCurrency: "ref",
    entryMode: "unit",
    productId,
    quantity: 1,
    subtotalRef: unitCostRef,
    subtotalVes: unitCostRef * RATE,
    taxRateCode,
    taxRef: 0,
    taxVes: 0,
    unitCostRef,
    unitCostVes: unitCostRef * RATE,
  };
}

function packLine(
  productId: string,
  unitCostRef: number,
  pack: { label: string; unitsPerPack: number },
): PurchaseItemInput {
  return {
    costCurrency: "ref",
    entryMode: "pack",
    packCostRef: unitCostRef * pack.unitsPerPack,
    packCostVes: unitCostRef * pack.unitsPerPack * RATE,
    packCount: 1,
    packLabel: pack.label,
    productId,
    subtotalRef: unitCostRef * pack.unitsPerPack,
    subtotalVes: unitCostRef * pack.unitsPerPack * RATE,
    taxRateCode: "exento",
    taxRef: 0,
    taxVes: 0,
    unitCostRef,
    unitCostVes: unitCostRef * RATE,
    unitsPerPack: pack.unitsPerPack,
  };
}

function buy(items: PurchaseItemInput[], extra: Partial<PurchaseInput> = {}) {
  return createPurchase(
    { discountRef: 0, items, refRateVes: RATE, supplierId: SUPPLIER, taxRef: 0, ...extra },
    DEFAULT_STORE_ID,
  );
}

/** Vínculos del producto (activos e inactivos), reducidos a lo que el test afirma. */
function linksOf(productId: string) {
  return listProductSuppliers(productId, new URLSearchParams({ limit: "100" }), DEFAULT_STORE_ID)
    .items.map((link) => ({
      cost: link.lastCostRef,
      id: link.id,
      isActive: link.isActive,
      isPreferred: link.isPreferred,
      origin: link.lastPriceOrigin,
      packs: link.packUnits.map((pack) => `${pack.label}x${pack.unitsPerPack}${pack.isDefault ? "*" : ""}`),
      purchased: link.lastPurchasedAt !== undefined,
      sku: link.supplierSku,
      supplierId: link.supplierId,
    }))
    .sort((first, second) => first.supplierId.localeCompare(second.supplierId));
}

function historyOf(linkId: string) {
  return listSupplierProductPriceHistory(linkId, new URLSearchParams({ limit: "100" }), DEFAULT_STORE_ID)
    .items.map((entry) => `${entry.origin}:${entry.oldCostRef ?? "-"}->${entry.newCostRef}`)
    .sort();
}

describe("purchases.mock-server · vínculo automático (COM-02)", () => {
  it("producto no vinculado comprado por empaque: 1 vínculo habitual con el costo de la línea (con IVA), su empaque predeterminado e historial 'compra'", () => {
    const productId = newProduct();

    buy([{ ...packLine(productId, 2, { label: "Bulto", unitsPerPack: 12 }), supplierSku: "abc-1", taxRateCode: "general" }]);
    const links = linksOf(productId);

    expect(links).toEqual([
      {
        cost: 2.32,
        id: expect.any(String),
        isActive: true,
        isPreferred: true,
        origin: "compra",
        packs: ["Bultox12*"],
        purchased: true,
        sku: "abc-1",
        supplierId: SUPPLIER,
      },
    ]);
    expect(historyOf(links[0].id)).toEqual(["compra:-->2.32"]);
  });

  it("producto no vinculado comprado por unidad: vínculo con costo y sin empaque", () => {
    const productId = newProduct();

    buy([unitLine(productId, 3)]);

    expect(linksOf(productId)).toEqual([
      expect.objectContaining({ cost: 3, isPreferred: true, packs: [], supplierId: SUPPLIER }),
    ]);
  });

  it("ya vinculado: no duplica ni añade empaques; actualiza el costo con historial 'compra'", () => {
    const productId = newProduct();
    buy([packLine(productId, 2, { label: "Caja", unitsPerPack: 6 })]);

    buy([packLine(productId, 2.5, { label: "Bulto", unitsPerPack: 24 })]);
    const links = linksOf(productId);

    expect(links).toEqual([expect.objectContaining({ cost: 2.5, packs: ["Cajax6*"], supplierId: SUPPLIER })]);
    expect(historyOf(links[0].id)).toEqual(["compra:-->2", "compra:2->2.5"]);
  });

  it("el mismo producto en varias líneas: 1 vínculo, un empaque por tamaño y solo el primero predeterminado", () => {
    const productId = newProduct();

    buy([
      packLine(productId, 1, { label: "Caja", unitsPerPack: 6 }),
      packLine(productId, 1, { label: "Bulto", unitsPerPack: 24 }),
      packLine(productId, 1, { label: "caja", unitsPerPack: 6 }),
    ]);

    expect(linksOf(productId)).toEqual([expect.objectContaining({ packs: ["Cajax6*", "Bultox24"] })]);
  });

  it("vínculo desactivado: la compra reactiva el mismo vínculo y conserva sus empaques", () => {
    const productId = newProduct();
    buy([packLine(productId, 2, { label: "Caja", unitsPerPack: 6 })]);
    const [link] = linksOf(productId);
    deactivateSupplierProduct(link.id, DEFAULT_STORE_ID);

    buy([packLine(productId, 2, { label: "Bulto", unitsPerPack: 24 })]);

    expect(linksOf(productId)).toEqual([
      expect.objectContaining({ id: link.id, isActive: true, isPreferred: true, packs: ["Cajax6*"] }),
    ]);
  });

  it("línea por empaque sobre el producto EMPAQUE de un par (semilla: cigarros x10): costo del empaque y sin empaque del proveedor", () => {
    buy([packLine(PACK_PRODUCT, 1, { label: "Caja x10", unitsPerPack: 10 })]);

    expect(linksOf(PACK_PRODUCT)).toEqual([expect.objectContaining({ cost: 10, packs: [], supplierId: SUPPLIER })]);
  });

  it("habitual: se respeta el que el producto ya tenía; sin habitual, el vínculo nuevo lo es", () => {
    const productId = newProduct();
    buy([unitLine(productId, 2)]);

    buy([unitLine(productId, 3)], { supplierId: OTHER_SUPPLIER });
    const withBoth = linksOf(productId).map((link) => [link.supplierId, link.isPreferred]);

    const orphanId = newProduct();
    buy([unitLine(orphanId, 2)]);
    deactivateSupplierProduct(linksOf(orphanId)[0].id, DEFAULT_STORE_ID);
    buy([unitLine(orphanId, 3)], { supplierId: OTHER_SUPPLIER });

    expect(withBoth).toEqual([
      [SUPPLIER, true],
      [OTHER_SUPPLIER, false],
    ]);
    expect(linksOf(orphanId).map((link) => [link.supplierId, link.isActive, link.isPreferred])).toEqual([
      [SUPPLIER, false, false],
      [OTHER_SUPPLIER, true, true],
    ]);
  });

  it("pedido: el vínculo nace con el costo de la línea, origen 'vinculacion' y sin fecha de compra; sobre un vínculo activo no cambia nada", () => {
    const productId = newProduct();

    buy([packLine(productId, 2, { label: "Bulto", unitsPerPack: 10 })], { status: "pedido" });
    const created = linksOf(productId);
    buy([unitLine(productId, 9)], { status: "pedido" });

    expect(created).toEqual([
      expect.objectContaining({ cost: 2, isPreferred: true, origin: "vinculacion", packs: ["Bultox10*"], purchased: false }),
    ]);
    expect(linksOf(productId)).toEqual(created);
    expect(historyOf(created[0].id)).toEqual(["vinculacion:-->2"]);
    expect(mockProducts.find((product) => product.id === productId)?.currentCostRef).toBe(1);
  });

  it("pedido sobre un vínculo desactivado: lo reactiva sin tocar su costo", () => {
    const productId = newProduct();
    buy([unitLine(productId, 2)]);
    const [link] = linksOf(productId);
    deactivateSupplierProduct(link.id, DEFAULT_STORE_ID);

    buy([unitLine(productId, 9)], { status: "pedido" });

    expect(linksOf(productId)).toEqual([expect.objectContaining({ cost: 2, id: link.id, isActive: true })]);
    expect(historyOf(link.id)).toEqual(["compra:-->2"]);
  });

  it("reintento con el mismo clientRequestId: misma compra y un solo vínculo, empaque e historial", () => {
    const productId = newProduct();
    const request = {
      clientRequestId: "3d1f6a0e-9b1c-4d58-8a35-0f6f1d2c7b11",
      items: [packLine(productId, 2, { label: "Bulto", unitsPerPack: 12 })],
    };

    const first = buy(request.items, { clientRequestId: request.clientRequestId });
    const second = buy(request.items, { clientRequestId: request.clientRequestId });
    const links = linksOf(productId);

    expect(second).toBe(first);
    expect(links).toEqual([expect.objectContaining({ packs: ["Bultox12*"] })]);
    expect(historyOf(links[0].id)).toEqual(["compra:-->2"]);
  });

  it.each([
    ["proveedor inactivo", "cont-inactive", "El proveedor Cliente Inactivo está inactivo: no se puede registrar la compra"],
    ["contacto que solo es cliente", "cont-customer", "El contacto Ferreteria La Central no es proveedor: no se puede registrar la compra"],
    ["proveedor inexistente", "cont-no-existe", "Proveedor no encontrado"],
  ])("%s: 400 con el mensaje de la base y nada creado (ni vínculo ni costo)", (_caso, supplierId, message) => {
    const productId = newProduct();

    expect(() => buy([unitLine(productId, 5)], { supplierId })).toThrow(
      expect.objectContaining({ message, status: 400 }),
    );
    expect(() => buy([unitLine(productId, 5)], { status: "pedido", supplierId })).toThrow(message);
    expect(linksOf(productId)).toEqual([]);
    expect(mockProducts.find((product) => product.id === productId)?.currentCostRef).toBe(1);
  });

  it("una línea con IVA inválido rechaza la compra y no deja el vínculo de las líneas válidas", () => {
    const productId = newProduct();

    expect(() => buy([unitLine(productId, 5), unitLine(newProduct(), 5, "no-existe")])).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(linksOf(productId)).toEqual([]);
  });
});
