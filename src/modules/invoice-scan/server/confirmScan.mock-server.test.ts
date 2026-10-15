/**
 * @jest-environment node
 */
/** SCN-06 · mock con paridad de confirm_invoice_scan + learn_invoice_aliases. */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  finalizeInvoiceScan,
  getMockInvoiceScan,
  listMockLearnedAliases,
  precheckInvoiceScan,
  registerMockInvoiceScan,
  releaseInvoiceScanClaim,
  resetMockInvoiceScans,
} from "./confirmScan.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const KEY_1 = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const KEY_2 = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";

const extracted = { lines: [{ rawText: "Harina P.A.N. 1kg" }, { rawText: "  " }] };

async function confirm(scanId: string, purchaseId: string, productId: string, key: string) {
  const scan = await precheckInvoiceScan({ clientRequestId: key, scanId }, DEFAULT_STORE_ID);

  return finalizeInvoiceScan(
    scan,
    {
      clientRequestId: key,
      lines: [
        { lineIndex: 0, packLabel: "Bulto", productId, unitsPerPack: 20 },
        { lineIndex: 1, productId },
        { lineIndex: 5, productId },
      ],
      items: [{ entryMode: "pack", packLabel: "Bulto", productId, unitsPerPack: 20 }],
      purchaseId,
      supplierId: SUPPLIER,
    },
    DEFAULT_STORE_ID,
  );
}

describe("confirmScan.mock-server", () => {
  beforeEach(() => resetMockInvoiceScans());

  it("escaneo ajeno o inexistente → 400 Escaneo no encontrado", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-ajeno", storeId: OTHER_STORE_ID });

    await expect(precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-ajeno" }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      message: "Escaneo no encontrado",
      status: 400,
    });
    await expect(precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "no-existe" }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each(["discarded", "failed"] as const)("escaneo %s → 400", async (status) => {
    registerMockInvoiceScan({ extracted, id: "scan-x", status });

    await expect(precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-x" }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      message: "El escaneo no está disponible",
      status: 400,
    });
  });

  it("confirma con el JSON enriquecido y aprende solo alias no vacíos dentro de rango", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });

    const outcome = await confirm("scan-1", "purchase-1", PRODUCT_A, KEY_1);
    const scan = getMockInvoiceScan("scan-1");

    expect(outcome).toEqual({ confirmed: true, learned: 1 });
    expect(scan?.status).toBe("confirmed");
    expect(scan?.confirmed?.lines.map((line) => [line.lineIndex, line.aliasNorm])).toEqual([
      [0, "harina p a n 1kg"],
      [1, ""],
    ]);
    expect(listMockLearnedAliases(DEFAULT_STORE_ID, SUPPLIER)).toEqual([
      {
        aliasNorm: "harina p a n 1kg",
        hits: 1,
        packLabel: "Bulto",
        productId: PRODUCT_A,
        storeId: DEFAULT_STORE_ID,
        supplierId: SUPPLIER,
        unitsPerPack: 20,
      },
    ]);
  });

  it("confirmado con otra clave → 400; con la misma → replay sin volver a aprender", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });
    await confirm("scan-1", "purchase-1", PRODUCT_A, KEY_1);

    await expect(confirm("scan-1", "purchase-2", PRODUCT_A, KEY_2)).rejects.toMatchObject({
      message: "El escaneo ya fue confirmado",
      status: 400,
    });
    await expect(confirm("scan-1", "purchase-1", PRODUCT_A, KEY_1)).resolves.toEqual({
      confirmed: true,
      learned: null,
    });
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)[0].hits).toBe(1);
  });

  it("mismo producto suma hits; otro producto reasigna el registro con hits = 1 (caos 6.10)", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });
    registerMockInvoiceScan({ extracted, id: "scan-2" });
    registerMockInvoiceScan({ extracted, id: "scan-3" });

    await confirm("scan-1", "purchase-1", PRODUCT_A, KEY_1);
    await confirm("scan-2", "purchase-2", PRODUCT_A, KEY_2);
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)).toEqual([
      expect.objectContaining({ hits: 2, productId: PRODUCT_A }),
    ]);

    await confirm("scan-3", "purchase-3", PRODUCT_B, "0d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a");
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)).toEqual([
      expect.objectContaining({ hits: 1, productId: PRODUCT_B }),
    ]);
  });

  it("reclamo: otro intento vigente → 400 antes de crear; el mismo intento puede reintentar (SCN-06-F1)", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });

    await precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID);
    await expect(
      precheckInvoiceScan({ clientRequestId: KEY_2, scanId: "scan-1" }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "El escaneo se está confirmando en otra compra", status: 400 });
    await expect(
      precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID),
    ).resolves.toMatchObject({ replay: false });
    expect(getMockInvoiceScan("scan-1")?.claimRequestId).toBe(KEY_1);
  });

  it("liberar el reclamo deja reclamar con otra clave; finalize con reclamo ajeno no confirma", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    registerMockInvoiceScan({ extracted, id: "scan-1" });

    const first = await precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID);
    await releaseInvoiceScanClaim({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID);
    await precheckInvoiceScan({ clientRequestId: KEY_2, scanId: "scan-1" }, DEFAULT_STORE_ID);

    await expect(
      finalizeInvoiceScan(
        first,
        { clientRequestId: KEY_1, items: [], lines: [], purchaseId: "purchase-1", supplierId: SUPPLIER },
        DEFAULT_STORE_ID,
      ),
    ).resolves.toEqual({ confirmed: false, learned: null });
    expect(getMockInvoiceScan("scan-1")).toMatchObject({ claimRequestId: KEY_2, status: "extracted" });
    jest.restoreAllMocks();
  });

  it("mismo producto en modo unidad borra el empaque aprendido; sin la clave lo conserva (SCN-06-F2 · A1)", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });
    registerMockInvoiceScan({ extracted, id: "scan-2" });
    registerMockInvoiceScan({ extracted, id: "scan-3" });
    await confirm("scan-1", "purchase-1", PRODUCT_A, KEY_1);

    // Empaque que no coincide con el item: no se envía la clave → se conserva.
    const second = await precheckInvoiceScan({ clientRequestId: KEY_2, scanId: "scan-2" }, DEFAULT_STORE_ID);
    await finalizeInvoiceScan(
      second,
      {
        clientRequestId: KEY_2,
        items: [{ entryMode: "pack", packLabel: "Bulto", productId: PRODUCT_A, unitsPerPack: 20 }],
        lines: [{ lineIndex: 0, packLabel: "x", productId: PRODUCT_A, unitsPerPack: 99 }],
        purchaseId: "purchase-2",
        supplierId: SUPPLIER,
      },
      DEFAULT_STORE_ID,
    );
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)[0]).toMatchObject({ hits: 2, packLabel: "Bulto", unitsPerPack: 20 });

    // Modo unidad: claves en null → se borra.
    const key3 = "0d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a";
    const third = await precheckInvoiceScan({ clientRequestId: key3, scanId: "scan-3" }, DEFAULT_STORE_ID);
    await finalizeInvoiceScan(
      third,
      {
        clientRequestId: key3,
        items: [{ entryMode: "unit", productId: PRODUCT_A }],
        lines: [{ lineIndex: 0, productId: PRODUCT_A }],
        purchaseId: "purchase-3",
        supplierId: SUPPLIER,
      },
      DEFAULT_STORE_ID,
    );
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)[0]).toMatchObject({ hits: 3, packLabel: null, unitsPerPack: null });
  });

  it("línea con producto fuera de los items: no se aprende (SCN-06-F2 · M3)", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    registerMockInvoiceScan({ extracted, id: "scan-1" });

    const scan = await precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID);
    const outcome = await finalizeInvoiceScan(
      scan,
      {
        clientRequestId: KEY_1,
        items: [{ entryMode: "unit", productId: PRODUCT_A }],
        lines: [{ lineIndex: 0, packLabel: "IGNORA", productId: PRODUCT_B, unitsPerPack: 100000 }],
        purchaseId: "p-1",
        supplierId: SUPPLIER,
      },
      DEFAULT_STORE_ID,
    );

    expect(outcome).toEqual({ confirmed: true, learned: 0 });
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)).toEqual([]);
    jest.restoreAllMocks();
  });

  it("item con etiqueta de empaque de más de 100 caracteres: se aprende recortada a 100 (SCN-06-F4 · M-n1)", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });

    const scan = await precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID);
    const outcome = await finalizeInvoiceScan(
      scan,
      {
        clientRequestId: KEY_1,
        items: [{ entryMode: "pack", packLabel: "C".repeat(150), productId: PRODUCT_A, unitsPerPack: 12 }],
        lines: [{ lineIndex: 0, productId: PRODUCT_A, unitsPerPack: 12 }],
        purchaseId: "p-1",
        supplierId: SUPPLIER,
      },
      DEFAULT_STORE_ID,
    );

    expect(outcome).toEqual({ confirmed: true, learned: 1 });
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)[0]).toMatchObject({
      packLabel: "C".repeat(100),
      unitsPerPack: 12,
    });
  });

  it("alias normalizado de más de 200 caracteres: se guarda en confirmed pero no se aprende", async () => {
    const longText = Array.from({ length: 60 }, (_, index) => `palabra${index}`).join(" ");
    registerMockInvoiceScan({ extracted: { lines: [{ rawText: longText }] }, id: "scan-1" });

    const scan = await precheckInvoiceScan({ clientRequestId: KEY_1, scanId: "scan-1" }, DEFAULT_STORE_ID);
    const outcome = await finalizeInvoiceScan(
      scan,
      {
        clientRequestId: KEY_1,
        items: [{ entryMode: "unit", productId: PRODUCT_A }],
        lines: [{ lineIndex: 0, productId: PRODUCT_A }],
        purchaseId: "p-1",
        supplierId: SUPPLIER,
      },
      DEFAULT_STORE_ID,
    );

    expect(outcome).toEqual({ confirmed: true, learned: 0 });
    expect(getMockInvoiceScan("scan-1")?.confirmed?.lines[0].rawText).toBe(longText);
    expect(listMockLearnedAliases(DEFAULT_STORE_ID)).toEqual([]);
  });
});
