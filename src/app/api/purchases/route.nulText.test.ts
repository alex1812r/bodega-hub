/**
 * @jest-environment node
 */
/**
 * COM-F7 (M3) · un carácter nulo (`\u0000`) en un texto de la compra llegaba a
 * Postgres, que no lo admite en `text` ni en `jsonb`, y la ruta respondía 500
 * "unsupported Unicode escape sequence". Es un dato inválido: 400 con mensaje en
 * español y nada creado.
 */

import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import { NUL_TEXT_MESSAGE } from "@/modules/purchases/schemas/safeText";

import { POST } from "./route";

jest.mock("../../../modules/purchases/services/purchases.mock-server", () => {
  const actual = jest.requireActual<
    typeof import("../../../modules/purchases/services/purchases.mock-server")
  >("../../../modules/purchases/services/purchases.mock-server");

  return { ...actual, createPurchase: jest.fn(actual.createPurchase) };
});

const createPurchase = jest.mocked(purchasesMockServer.createPurchase);

const unitItem = {
  costCurrency: "ref",
  entryMode: "unit",
  productId: "prod-cable",
  quantity: 2,
  subtotalRef: 4,
  subtotalVes: 2040,
  taxRate: 0,
  taxRef: 0,
  taxVes: 0,
  unitCostRef: 2,
  unitCostVes: 1020,
};

const packItem = {
  costCurrency: "ref",
  entryMode: "pack",
  packCostRef: 4,
  packCostVes: 2040,
  packCount: 1,
  packLabel: "Caja x2",
  productId: "prod-cable",
  subtotalRef: 4,
  subtotalVes: 2040,
  taxRate: 0,
  taxRef: 0,
  taxVes: 0,
  unitCostRef: 2,
  unitCostVes: 1020,
  unitsPerPack: 2,
};

const purchase = {
  discountRef: 0,
  discountVes: 0,
  items: [unitItem],
  refRateVes: 510,
  subtotalRef: 4,
  subtotalVes: 2040,
  supplierId: "cont-supplier",
  taxRef: 0,
  taxVes: 0,
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "admin" },
      method: "POST",
    }),
  );
}

describe("POST /api/purchases · carácter nulo en un texto (COM-F7 M3)", () => {
  beforeEach(() => {
    createPurchase.mockClear();
  });

  it.each<[string, Array<number | string>, unknown]>([
    ["notes", ["notes"], { ...purchase, notes: "nul\u0000o" }],
    ["purchaseNumber", ["purchaseNumber"], { ...purchase, purchaseNumber: "n\u0000repro" }],
    ["supplierId", ["supplierId"], { ...purchase, supplierId: "cont\u0000supplier" }],
    [
      "items[0].supplierSku",
      ["items", 0, "supplierSku"],
      { ...purchase, items: [{ ...unitItem, supplierSku: "a\u0000b" }] },
    ],
    [
      "items[0].packLabel",
      ["items", 0, "packLabel"],
      { ...purchase, items: [{ ...packItem, packLabel: "Caja\u0000x6" }] },
    ],
    [
      "items[0].productId",
      ["items", 0, "productId"],
      { ...purchase, items: [{ ...unitItem, productId: "prod\u0000cable" }] },
    ],
    [
      "items[0].taxRateCode",
      ["items", 0, "taxRateCode"],
      { ...purchase, items: [{ ...unitItem, taxRateCode: "exen\u0000to" }] },
    ],
    [
      "initialPayment.notes",
      ["initialPayment", "notes"],
      {
        ...purchase,
        initialPayment: {
          amount: 100,
          clientRequestId: "8b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e",
          method: "efectivo_ves",
          notes: "pago\u0000inicial",
        },
      },
    ],
  ])("%s → 400 en español y nada creado", async (_field, path, body) => {
    const response = await post(body);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(payload.error.issues).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/no permitidos/), path }),
    ]);
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("el mensaje de los textos de la compra es el de `safeText`", async () => {
    const response = await post({ ...purchase, notes: "\u0000" });
    const payload = await response.json();

    expect(payload.error.issues[0].message).toBe(NUL_TEXT_MESSAGE);
  });

  it("los demás textos raros se siguen guardando tal cual", async () => {
    const notes = "'; drop table purchases; -- <b>ñ</b> \u202E 🙂\n\tfin";
    const response = await post({ ...purchase, notes, purchaseNumber: "C-ñ-1" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.id).toEqual(expect.any(String));
    expect(createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ notes, purchaseNumber: "C-ñ-1" }),
      expect.any(String),
    );
  });
});
