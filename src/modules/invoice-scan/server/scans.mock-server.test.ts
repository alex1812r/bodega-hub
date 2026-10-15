/**
 * @jest-environment node
 */
import { ApiError } from "@/lib/api/apiError";
import { mockState } from "@/shared/mocks/mockStore";

import type { InvoiceExtraction } from "../contracts";
import {
  discardScan,
  findScanByHash,
  getDailyUsage,
  getScan,
  insertScan,
  listFewShotExamples,
  markScanFailed,
  purgeExpiredScans,
} from "./scans.mock-server";
import {
  DEFAULT_INVOICE_SCAN_DAILY_LIMIT,
  readInvoiceScanDailyLimit,
  type InvoiceScanInsert,
  type InvoiceScanRow,
} from "./scans.types";

const storeA = { storeId: "store-a", userId: "user-a" };
const storeB = { storeId: "store-b", userId: "user-b" };
const supplierId = "33333333-3333-4333-8333-333333333333";

const extraction: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [],
  supplier: { name: "Distribuidora Alfa" },
  warnings: [],
};

function input(overrides: Partial<InvoiceScanInsert> = {}): InvoiceScanInsert {
  return {
    extracted: extraction,
    imageSha256: "hash-1",
    model: "mock-model",
    provider: "mock",
    storagePath: "store-a/hash-1.jpg",
    ...overrides,
  };
}

function store() {
  return mockState("invoice-scan:scans", () => new Map<string, InvoiceScanRow>());
}

/** Lo que hará Emparejamiento al confirmar (SCN-06): no es parte de este repositorio. */
function confirm(id: string, at: string) {
  const scan = store().get(id) as InvoiceScanRow;
  store().set(id, { ...scan, confirmed: extraction, createdAt: at, status: "confirmed", supplierId });
}

beforeEach(() => {
  store().clear();
  jest.useRealTimers();
});

describe("scans.mock-server · caché por hash", () => {
  it("devuelve el mismo escaneo para el mismo hash y tienda, sin duplicar filas", async () => {
    const first = await insertScan(storeA, input());
    const again = await insertScan(storeA, input({ provider: "otro" }));

    expect(again.id).toBe(first.id);
    expect(again.provider).toBe("mock");
    expect(await findScanByHash(storeA, "hash-1")).toMatchObject({ id: first.id, status: "extracted" });
    expect(store().size).toBe(1);
  });

  it("el hash es por tienda: B no ve el caché de A", async () => {
    await insertScan(storeA, input());

    expect(await findScanByHash(storeB, "hash-1")).toBeNull();
    const fromB = await insertScan(storeB, input({ storagePath: "store-b/hash-1.jpg" }));
    expect(fromB.storeId).toBe("store-b");
    expect(store().size).toBe(2);
  });
});

describe("scans.mock-server · failed → retry", () => {
  it("un escaneo failed no es caché y el reintento reutiliza su fila", async () => {
    const failed = await insertScan(
      storeA,
      input({ error: "Tiempo de espera agotado", extracted: null, status: "failed" }),
    );

    expect(failed.extracted).toBeNull();
    expect(await findScanByHash(storeA, "hash-1")).toBeNull();

    const retry = await insertScan(storeA, input({ inputTokens: 1200 }));

    expect(retry).toMatchObject({ error: null, id: failed.id, inputTokens: 1200, status: "extracted" });
    expect(await findScanByHash(storeA, "hash-1")).toMatchObject({ id: failed.id });
    expect(store().size).toBe(1);
  });

  it("markScanFailed solo afecta a escaneos extracted de la propia tienda", async () => {
    const scan = await insertScan(storeA, input());

    expect(await markScanFailed(storeB, scan.id, "x")).toBeNull();
    expect(await markScanFailed(storeA, scan.id, "Fallo al emparejar")).toMatchObject({
      error: "Fallo al emparejar",
      status: "failed",
    });
    expect(await markScanFailed(storeA, scan.id, "otra vez")).toBeNull();
  });
});

describe("scans.mock-server · tienda y descarte", () => {
  it("getScan y discardScan devuelven null (404) para un escaneo de otra tienda", async () => {
    const scan = await insertScan(storeA, input());

    expect(await getScan(storeB, scan.id)).toBeNull();
    expect(await discardScan(storeB, scan.id)).toBeNull();
    expect(await getScan(storeA, scan.id)).toMatchObject({ id: scan.id, status: "extracted" });
    expect(await getScan(storeA, "no-existe")).toBeNull();
  });

  it("solo descarta desde extracted; después responde 409", async () => {
    const scan = await insertScan(storeA, input());

    expect(await discardScan(storeA, scan.id)).toMatchObject({ status: "discarded" });
    await expect(discardScan(storeA, scan.id)).rejects.toMatchObject({ status: 409 });
    await expect(discardScan(storeA, scan.id)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("scans.mock-server · cuota diaria (día operativo de Caracas)", () => {
  it("suma las páginas de hoy en Caracas, failed incluidos, y se reinicia a medianoche de Caracas", async () => {
    jest.useFakeTimers();
    // 23:30 del 14-oct en Caracas (UTC-4) = 03:30Z del 15-oct.
    jest.setSystemTime(new Date("2026-10-15T03:30:00.000Z"));
    await insertScan(storeA, input({ imageSha256: "late-1", pages: 2 }));
    await insertScan(storeA, input({ error: "x", imageSha256: "late-2", status: "failed" }));
    await insertScan(storeB, input({ imageSha256: "b-1", pages: 5 }));

    expect(await getDailyUsage(storeA, 50)).toEqual({ limit: 50, remaining: 47, used: 3 });

    // 00:10 del 15-oct en Caracas: día nuevo aunque en UTC sea el mismo día que antes.
    jest.setSystemTime(new Date("2026-10-15T04:10:00.000Z"));
    await insertScan(storeA, input({ imageSha256: "early-1" }));

    expect(await getDailyUsage(storeA, 50)).toEqual({ limit: 50, remaining: 49, used: 1 });
    expect(await getDailyUsage(storeA, 1)).toEqual({ limit: 1, remaining: 0, used: 1 });
  });

  it("readInvoiceScanDailyLimit lee INVOICE_SCAN_DAILY_LIMIT con 50 por defecto", () => {
    expect(readInvoiceScanDailyLimit({})).toBe(DEFAULT_INVOICE_SCAN_DAILY_LIMIT);
    expect(readInvoiceScanDailyLimit({ INVOICE_SCAN_DAILY_LIMIT: " 120 " })).toBe(120);
    expect(readInvoiceScanDailyLimit({ INVOICE_SCAN_DAILY_LIMIT: "-3" })).toBe(50);
    expect(readInvoiceScanDailyLimit({ INVOICE_SCAN_DAILY_LIMIT: "abc" })).toBe(50);
  });
});

describe("scans.mock-server · few-shot por proveedor", () => {
  it("devuelve como mucho 3 confirmados del proveedor y la tienda, los más recientes primero", async () => {
    for (let day = 1; day <= 5; day += 1) {
      const scan = await insertScan(
        storeA,
        input({ imageSha256: `s-${day}`, storagePath: `store-a/s-${day}.jpg` }),
      );
      confirm(scan.id, `2026-10-0${day}T12:00:00.000Z`);
    }
    await insertScan(storeA, input({ imageSha256: "sin-confirmar" }));
    const other = await insertScan(storeB, input({ imageSha256: "b" }));
    confirm(other.id, "2026-10-09T12:00:00.000Z");

    const examples = await listFewShotExamples(storeA, supplierId);

    expect(examples.map((example) => example.storagePath)).toEqual([
      "store-a/s-5.jpg",
      "store-a/s-4.jpg",
      "store-a/s-3.jpg",
    ]);
    expect(examples[0].confirmed).toEqual(extraction);
    expect(await listFewShotExamples(storeA, supplierId, 10)).toHaveLength(3);
    expect(await listFewShotExamples(storeA, supplierId, 1)).toHaveLength(1);
    expect(await listFewShotExamples(storeA, "otro-proveedor")).toEqual([]);
  });
});

describe("scans.mock-server · purga a 90 días", () => {
  it("borra los escaneos más antiguos que el corte en todas las tiendas y devuelve sus rutas", async () => {
    const now = new Date("2026-10-15T12:00:00.000Z");
    const old = await insertScan(storeA, input({ imageSha256: "old", storagePath: "store-a/old.jpg" }));
    const oldB = await insertScan(storeB, input({ imageSha256: "old-b", storagePath: "store-b/old.jpg" }));
    const fresh = await insertScan(storeA, input({ imageSha256: "fresh" }));
    store().set(old.id, { ...old, createdAt: "2026-07-01T12:00:00.000Z" });
    store().set(oldB.id, { ...oldB, createdAt: "2026-07-17T11:59:59.000Z" });
    store().set(fresh.id, { ...fresh, createdAt: "2026-07-17T12:00:00.000Z" });

    const result = await purgeExpiredScans(null, 90, now);

    expect(result.deletedIds.sort()).toEqual([old.id, oldB.id].sort());
    expect(result.storagePaths.sort()).toEqual(["store-a/old.jpg", "store-b/old.jpg"]);
    expect(await getScan(storeA, fresh.id)).not.toBeNull();
    expect(await getScan(storeA, old.id)).toBeNull();
  });
});
