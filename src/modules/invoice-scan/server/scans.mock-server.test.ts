/**
 * @jest-environment node
 */
import { ApiError } from "@/lib/api/apiError";
import { mockState } from "@/shared/mocks/mockStore";

import type { InvoiceExtraction } from "../contracts";
import {
  completeScan,
  discardScan,
  failScan,
  getDailyUsage,
  getScan,
  listFewShotExamples,
  deleteScansByIds,
  listExpiredScanObjects,
  listExpiredScans,
  removeScanObjects,
  reserveScan,
  seedScanForTest,
  seedScanObjectForTest,
} from "./scans.mock-server";
import {
  DEFAULT_INVOICE_SCAN_DAILY_LIMIT,
  readInvoiceScanDailyLimit,
  type InvoiceScanInsert,
  type InvoiceScanReserveInput,
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

describe("scans.mock-server · reserveScan (paridad con reserve_invoice_scan)", () => {
  function reserve(ctx = storeA, overrides: Partial<InvoiceScanReserveInput> = {}) {
    const imageSha256 = overrides.imageSha256 ?? "hash-1";

    return reserveScan(ctx, {
      imageSha256,
      limit: 50,
      model: "mock-model",
      pages: 1,
      provider: "mock",
      storagePath: `${ctx.storeId}/${imageSha256}/p1.jpg`,
      ...overrides,
    });
  }

  it("rechaza (400) una ruta que no es <tienda>/<hash>/p1.<ext> de la propia tienda, sin crear fila (N1)", async () => {
    for (const storagePath of ["store-b/hash-1/p1.jpg", "store-a/otro/p1.jpg", "store-a/hash-1/p2.jpg", "store-a/hash-1/p1.gif"]) {
      await expect(reserve(storeA, { storagePath })).rejects.toMatchObject({ status: 400 });
    }
    expect(store().size).toBe(0);
  });

  it("la ventana de processing crece con las páginas: 50 s por página + 60 s (N6)", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
    const id = ((await reserve(storeA, { pages: 10 })) as { id: string }).id;

    // 5 min después una lectura de 10 páginas puede seguir viva (ventana 560 s).
    jest.setSystemTime(new Date("2026-10-15T12:05:00.000Z"));
    expect(await reserve(storeA, { pages: 10 })).toEqual({ id, outcome: "in_progress" });

    jest.setSystemTime(new Date("2026-10-15T12:09:21.000Z"));
    expect(await reserve(storeA, { pages: 10 })).toMatchObject({ id, outcome: "reserved" });
  });

  it("failScan con reembolso resta las páginas del intento sin bajar de 0 (N8)", async () => {
    const id = ((await reserve(storeA, { pages: 2 })) as { id: string }).id;
    await failScan(storeA, id, "UPLOAD_ERROR", true);

    expect(store().get(id)).toMatchObject({ error: "UPLOAD_ERROR", status: "failed", usagePages: 0 });
    expect(await getDailyUsage(storeA, 50)).toMatchObject({ used: 0 });

    await reserve(storeA, { pages: 2 });
    store().set(id, { ...(store().get(id) as InvoiceScanRow), usagePages: 1 });
    await failScan(storeA, id, "UPLOAD_ERROR", true);
    expect(store().get(id)).toMatchObject({ usagePages: 0 });
  });

  it("reserva en processing y cobra; la misma foto mientras se lee es in_progress", async () => {
    const first = await reserve();

    expect(first).toMatchObject({ limit: 50, outcome: "reserved", used: 1 });
    expect(await reserve()).toEqual({ id: (first as { id: string }).id, outcome: "in_progress" });
    expect(store().size).toBe(1);
    expect(await getDailyUsage(storeA, 50)).toMatchObject({ used: 1 });
  });

  it("5 reservas simultáneas con la misma foto: 1 reserved y 4 in_progress", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve()));

    expect(results.filter((result) => result.outcome === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "in_progress")).toHaveLength(4);
  });

  it("cuota atómica: con límite 2, de 5 reservas simultáneas solo 2 pasan", async () => {
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((n) => reserve(storeA, { imageSha256: `q-${n}`, limit: 2 })),
    );

    expect(results.filter((result) => result.outcome === "reserved")).toHaveLength(2);
    expect(results.filter((result) => result.outcome === "quota")).toEqual(
      Array.from({ length: 3 }, () => ({ limit: 2, outcome: "quota", used: 2 })),
    );
  });

  it("extracted o confirmed es caché, por tienda", async () => {
    const reserved = await reserve();
    const id = (reserved as { id: string }).id;
    await completeScan(storeA, id, {
      durationMs: 1,
      extracted: extraction,
      inputTokens: null,
      matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
      outputTokens: null,
    });

    expect(await reserve()).toEqual({ id, outcome: "cached" });
    expect(await reserve(storeB)).toMatchObject({ outcome: "reserved" });
    confirm(id, new Date().toISOString());
    expect(await reserve()).toEqual({ id, outcome: "cached" });
  });

  it("failed y discarded se reutilizan y suman páginas el mismo día", async () => {
    const id = ((await reserve(storeA, { pages: 2 })) as { id: string }).id;
    await failScan(storeA, id, "TIMEOUT");

    expect(await getScan(storeA, id)).toMatchObject({ error: "TIMEOUT", status: "failed" });
    expect(await reserve(storeA, { pages: 2 })).toMatchObject({ id, outcome: "reserved", used: 4 });

    store().set(id, { ...(store().get(id) as InvoiceScanRow), status: "discarded" });
    expect(await reserve(storeA, { pages: 2 })).toMatchObject({ id, outcome: "reserved", used: 6 });
    expect(store().get(id)).toMatchObject({ status: "processing", usagePages: 6 });
  });

  it("una fila de otro día se reutiliza cobrando solo este intento; processing caducado se recupera", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-15T03:30:00.000Z"));
    const id = ((await reserve(storeA, { pages: 3 })) as { id: string }).id;

    // 00:10 del día siguiente en Caracas: el processing de ayer ya caducó.
    jest.setSystemTime(new Date("2026-10-15T04:10:00.000Z"));
    expect(await reserve()).toMatchObject({ id, outcome: "reserved", used: 1 });
    expect(store().get(id)).toMatchObject({ pages: 1, usagePages: 1 });
  });

  it("completeScan y failScan solo cierran una fila processing de la propia tienda", async () => {
    const id = ((await reserve()) as { id: string }).id;

    await failScan(storeB, id, "x");
    expect(store().get(id)).toMatchObject({ status: "processing" });
    await failScan(storeA, id, "INVALID_OUTPUT");
    await failScan(storeA, id, "otra");
    expect(store().get(id)).toMatchObject({ error: "INVALID_OUTPUT", status: "failed" });
    expect(
      await completeScan(storeA, id, {
        durationMs: 1,
        extracted: extraction,
        inputTokens: null,
        matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
        outputTokens: null,
      }),
    ).toBeNull();
  });
});

describe("scans.mock-server · seedScanForTest (fixtures)", () => {
  it("no duplica filas por tienda + hash y reutiliza una fila failed", async () => {
    const failed = await seedScanForTest(
      storeA,
      input({ error: "Tiempo de espera agotado", extracted: null, status: "failed" }),
    );
    const retry = await seedScanForTest(storeA, input({ inputTokens: 1200 }));
    const again = await seedScanForTest(storeA, input({ provider: "otro" }));
    await seedScanForTest(storeB, input({ storagePath: "store-b/hash-1.jpg" }));

    expect(failed.extracted).toBeNull();
    expect(retry).toMatchObject({ error: null, id: failed.id, inputTokens: 1200, status: "extracted" });
    expect(again).toMatchObject({ id: failed.id, provider: "mock" });
    expect(store().size).toBe(2);
  });
});

describe("scans.mock-server · tienda y descarte", () => {
  it("getScan y discardScan devuelven null (404) para un escaneo de otra tienda", async () => {
    const scan = await seedScanForTest(storeA, input());

    expect(await getScan(storeB, scan.id)).toBeNull();
    expect(await discardScan(storeB, scan.id)).toBeNull();
    expect(await getScan(storeA, scan.id)).toMatchObject({ id: scan.id, status: "extracted" });
    expect(await getScan(storeA, "no-existe")).toBeNull();
  });

  it("solo descarta desde extracted; después responde 409", async () => {
    const scan = await seedScanForTest(storeA, input());

    expect(await discardScan(storeA, scan.id)).toMatchObject({ status: "discarded" });
    await expect(discardScan(storeA, scan.id)).rejects.toMatchObject({ status: 409 });
    await expect(discardScan(storeA, scan.id)).rejects.toBeInstanceOf(ApiError);
  });

  it.each([
    ["processing", "Este escaneo todavía se está leyendo; espera a que termine para descartarlo."],
    ["confirmed", "Este escaneo ya se confirmó en una compra y no se puede descartar."],
    ["discarded", "Este escaneo ya estaba descartado."],
    ["failed", "La lectura de este escaneo falló y no hay nada que descartar. Vuelve a escanear la factura."],
  ] as const)("409 en %s con su mensaje en español (N7)", async (status, message) => {
    const scan = await seedScanForTest(storeA, input());
    store().set(scan.id, { ...(store().get(scan.id) as InvoiceScanRow), status });

    await expect(discardScan(storeA, scan.id)).rejects.toMatchObject({ code: "CONFLICT", message, status: 409 });
  });
});

describe("scans.mock-server · cuota diaria (día operativo de Caracas)", () => {
  it("suma las páginas de hoy en Caracas, failed incluidos, y se reinicia a medianoche de Caracas", async () => {
    jest.useFakeTimers();
    // 23:30 del 14-oct en Caracas (UTC-4) = 03:30Z del 15-oct.
    jest.setSystemTime(new Date("2026-10-15T03:30:00.000Z"));
    await seedScanForTest(storeA, input({ imageSha256: "late-1", pages: 2 }));
    await seedScanForTest(storeA, input({ error: "x", imageSha256: "late-2", status: "failed" }));
    await seedScanForTest(storeB, input({ imageSha256: "b-1", pages: 5 }));

    expect(await getDailyUsage(storeA, 50)).toEqual({ limit: 50, remaining: 47, used: 3 });

    // 00:10 del 15-oct en Caracas: día nuevo aunque en UTC sea el mismo día que antes.
    jest.setSystemTime(new Date("2026-10-15T04:10:00.000Z"));
    await seedScanForTest(storeA, input({ imageSha256: "early-1" }));

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
      const scan = await seedScanForTest(
        storeA,
        input({ imageSha256: `s-${day}`, storagePath: `store-a/s-${day}.jpg` }),
      );
      confirm(scan.id, `2026-10-0${day}T12:00:00.000Z`);
    }
    await seedScanForTest(storeA, input({ imageSha256: "sin-confirmar" }));
    const other = await seedScanForTest(storeB, input({ imageSha256: "b" }));
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
  it("lista sin borrar los escaneos anteriores al corte en todas las tiendas, con todas sus páginas", async () => {
    const now = new Date("2026-10-15T12:00:00.000Z");
    const sha = "c".repeat(64);
    const old = await seedScanForTest(
      storeA,
      input({ imageSha256: sha, pages: 3, storagePath: `store-a/${sha}/p1.webp` }),
    );
    const oldB = await seedScanForTest(storeB, input({ imageSha256: "old-b", storagePath: "store-b/old.jpg" }));
    const fresh = await seedScanForTest(storeA, input({ imageSha256: "fresh" }));
    store().set(old.id, { ...old, createdAt: "2026-07-01T12:00:00.000Z" });
    store().set(oldB.id, { ...oldB, createdAt: "2026-07-17T11:59:59.000Z" });
    store().set(fresh.id, { ...fresh, createdAt: "2026-07-17T12:00:00.000Z" });

    const expired = await listExpiredScans(null, 90, now, 100);

    expect(expired).toEqual([
      {
        id: old.id,
        storagePaths: [`store-a/${sha}/p1.webp`, `store-a/${sha}/p2.webp`, `store-a/${sha}/p3.webp`],
      },
      { id: oldB.id, storagePaths: ["store-b/old.jpg"] },
    ]);
    expect(await listExpiredScans(null, 90, now, 1)).toEqual([expired[0]]);
    expect(await getScan(storeA, old.id)).not.toBeNull();

    expect(await deleteScansByIds(null, [old.id, oldB.id])).toBe(2);
    expect(await getScan(storeA, old.id)).toBeNull();
    expect(await getScan(storeB, oldB.id)).toBeNull();
    expect(await getScan(storeA, fresh.id)).not.toBeNull();
  });

  it("lista los objetos vencidos sin escaneo vivo, los más antiguos primero, y removeScanObjects los borra", async () => {
    const now = new Date("2026-10-15T12:00:00.000Z");
    const live = "d".repeat(64);
    const orphanA = `store-a/${"e".repeat(64)}/p1.jpg`;
    const orphanB = `store-b/${"f".repeat(64)}/p1.png`;
    const liveImage = `store-a/${live}/p1.jpg`;
    const fresh = `store-a/${"0".repeat(64)}/p1.jpg`;
    seedScanObjectForTest(orphanB, "2026-07-10T00:00:00.000Z");
    seedScanObjectForTest(orphanA, "2026-07-01T00:00:00.000Z");
    seedScanObjectForTest(liveImage, "2026-07-01T00:00:00.000Z");
    seedScanObjectForTest(fresh, "2026-07-17T12:00:00.000Z");
    const retried = await seedScanForTest(storeA, input({ imageSha256: live, storagePath: liveImage }));
    store().set(retried.id, { ...retried, createdAt: "2026-07-17T12:00:00.000Z" });

    expect(await listExpiredScanObjects(null, 90, now, 100)).toEqual([orphanA, orphanB]);
    expect(await listExpiredScanObjects(null, 90, now, 1)).toEqual([orphanA]);

    await removeScanObjects(null, [orphanA, orphanB]);
    expect(await listExpiredScanObjects(null, 90, now, 100)).toEqual([]);
  });
});
