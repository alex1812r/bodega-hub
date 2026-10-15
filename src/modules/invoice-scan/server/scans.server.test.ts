/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  discardScan,
  findScanByHash,
  getDailyUsage,
  getScan,
  insertScan,
  listFewShotExamples,
  markScanFailed,
  purgeExpiredScans,
} from "./scans.server";

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Call = [method: string, ...args: unknown[]];

const ctx = { storeId: "00000000-0000-4000-8000-000000000001", userId: "user-a" };
const scanId = "11111111-1111-4111-8111-111111111111";
const supplierId = "33333333-3333-4333-8333-333333333333";

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    confirmed: null,
    confirmed_at: null,
    created_at: "2026-10-15T12:00:00.000Z",
    created_by: "user-a",
    duration_ms: 900,
    error: null,
    extracted: { confidence: 1, currency: "VES", lines: [], supplier: { name: "Alfa" }, warnings: [] },
    id: scanId,
    image_sha256: "hash-1",
    input_tokens: 10,
    matched: {},
    model: "m",
    output_tokens: 20,
    pages: 1,
    provider: "mock",
    purchase_id: null,
    status: "extracted",
    storage_path: `${ctx.storeId}/hash-1.jpg`,
    store_id: ctx.storeId,
    supplier_id: null,
    ...overrides,
  };
}

/**
 * Cliente falso: cada `from()` consume el siguiente resultado de la cola y
 * registra la cadena de llamadas (`calls[i]` es la cadena del i-ésimo `from`).
 */
function fakeClient(results: Result[]) {
  const calls: Call[][] = [];
  const from = jest.fn((table: string) => {
    const chain: Call[] = [["from", table]];
    calls.push(chain);
    const result = results.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of ["select", "insert", "update", "delete", "eq", "gte", "lt", "not", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        chain.push([method, ...args]);
        return builder;
      };
    }
    for (const method of ["maybeSingle", "single"]) {
      builder[method] = () => {
        chain.push([method]);
        return Promise.resolve(result);
      };
    }
    return builder;
  });

  return { calls, client: { from } };
}

function useRouteClient(results: Result[]) {
  const fake = fakeClient(results);
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);
  return fake;
}

const ok = (data: unknown): Result => ({ data, error: null });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("scans.server · findScanByHash", () => {
  it("filtra por tienda y hash y mapea a camelCase (matched {} → null)", async () => {
    const { calls } = useRouteClient([ok(dbRow())]);

    const scan = await findScanByHash(ctx, "hash-1");

    expect(scan).toMatchObject({ id: scanId, imageSha256: "hash-1", matched: null, storeId: ctx.storeId });
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["eq", "store_id", ctx.storeId],
        ["eq", "image_sha256", "hash-1"],
      ]),
    );
  });

  it("un escaneo failed no es acierto de caché", async () => {
    useRouteClient([ok(dbRow({ extracted: {}, status: "failed" }))]);

    expect(await findScanByHash(ctx, "hash-1")).toBeNull();
  });
});

describe("scans.server · insertScan", () => {
  const input = { imageSha256: "hash-1", model: "m", provider: "mock", storagePath: `${ctx.storeId}/hash-1.jpg` };

  it("inserta con store_id y created_by del contexto y defaults {} si no hay lectura", async () => {
    const { calls } = useRouteClient([ok(null), ok(dbRow({ extracted: {}, status: "failed" }))]);

    const scan = await insertScan(ctx, { ...input, error: "timeout", status: "failed" });

    expect(scan.extracted).toBeNull();
    const insert = calls[1].find(([method]) => method === "insert");
    expect(insert?.[1]).toMatchObject({
      created_by: "user-a",
      error: "timeout",
      extracted: {},
      matched: {},
      pages: 1,
      status: "failed",
      store_id: ctx.storeId,
    });
  });

  it("reutiliza la fila failed del mismo hash con un update condicionado a failed", async () => {
    const { calls } = useRouteClient([
      ok(dbRow({ extracted: {}, status: "failed" })),
      ok(dbRow({ input_tokens: 99 })),
    ]);

    const scan = await insertScan(ctx, { ...input, inputTokens: 99 });

    expect(scan).toMatchObject({ id: scanId, inputTokens: 99, status: "extracted" });
    expect(calls[1]).toEqual(
      expect.arrayContaining([
        ["eq", "id", scanId],
        ["eq", "store_id", ctx.storeId],
        ["eq", "status", "failed"],
      ]),
    );
    const update = calls[1].find(([method]) => method === "update");
    expect(update?.[1]).toMatchObject({ error: null, input_tokens: 99, status: "extracted" });
    expect(update?.[1]).toHaveProperty("created_at");
    expect(calls.some((chain) => chain.some(([method]) => method === "insert"))).toBe(false);
  });

  it("si el hash ya está en caché devuelve esa fila sin escribir", async () => {
    const { calls } = useRouteClient([ok(dbRow())]);

    expect(await insertScan(ctx, input)).toMatchObject({ id: scanId });
    expect(calls).toHaveLength(1);
  });

  it("si pierde la carrera (23505) devuelve la fila ganadora", async () => {
    useRouteClient([
      ok(null),
      { data: null, error: { code: "23505", message: "duplicate key" } },
      ok(dbRow({ id: "winner" })),
    ]);

    expect(await insertScan(ctx, input)).toMatchObject({ id: "winner" });
  });
});

describe("scans.server · getScan / markScanFailed / discardScan", () => {
  it("getScan filtra por tienda; null si no es de la tienda o el id no es uuid", async () => {
    const { calls } = useRouteClient([ok(null)]);

    expect(await getScan(ctx, scanId)).toBeNull();
    expect(calls[0]).toEqual(expect.arrayContaining([["eq", "store_id", ctx.storeId]]));
    expect(await getScan(ctx, "no-uuid")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("markScanFailed solo actualiza extracted de la tienda", async () => {
    const { calls } = useRouteClient([ok(dbRow({ error: "x", status: "failed" }))]);

    expect(await markScanFailed(ctx, scanId, "x")).toMatchObject({ error: "x", status: "failed" });
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["update", { error: "x", status: "failed" }],
        ["eq", "store_id", ctx.storeId],
        ["eq", "status", "extracted"],
      ]),
    );
  });

  it("discardScan: null (404) si no es de la tienda, 409 si ya no está extracted", async () => {
    useRouteClient([ok(null)]);
    expect(await discardScan(ctx, scanId)).toBeNull();

    useRouteClient([ok(dbRow({ status: "confirmed" })), ok(null)]);
    await expect(discardScan(ctx, scanId)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const { calls } = useRouteClient([ok(dbRow()), ok(dbRow({ status: "discarded" }))]);
    expect(await discardScan(ctx, scanId)).toMatchObject({ status: "discarded" });
    expect(calls[1]).toEqual(expect.arrayContaining([["eq", "status", "extracted"]]));
  });
});

describe("scans.server · getDailyUsage", () => {
  it("suma páginas en el rango [00:00, 24:00) de Caracas del día de `now`", async () => {
    const { calls } = useRouteClient([ok([{ pages: 2 }, { pages: 1 }, { pages: 3 }])]);

    // 23:30 del 14-oct en Caracas.
    const usage = await getDailyUsage(ctx, 5, new Date("2026-10-15T03:30:00.000Z"));

    expect(usage).toEqual({ limit: 5, remaining: 0, used: 6 });
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["eq", "store_id", ctx.storeId],
        ["gte", "created_at", "2026-10-14T04:00:00.000Z"],
        ["lt", "created_at", "2026-10-15T04:00:00.000Z"],
      ]),
    );
  });
});

describe("scans.server · listFewShotExamples", () => {
  it("pide confirmados del proveedor en la tienda, recientes primero, máximo 3", async () => {
    const confirmed = { confidence: 1, currency: "USD", lines: [], supplier: { name: "Alfa" }, warnings: [] };
    const { calls } = useRouteClient([ok([{ confirmed, id: scanId, storage_path: "p.jpg" }])]);

    const examples = await listFewShotExamples(ctx, supplierId, 10);

    expect(examples).toEqual([{ confirmed, scanId, storagePath: "p.jpg" }]);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["eq", "store_id", ctx.storeId],
        ["eq", "supplier_id", supplierId],
        ["not", "confirmed", "is", null],
        ["order", "created_at", { ascending: false }],
        ["limit", 3],
      ]),
    );
  });

  it("no consulta con max 0 o proveedor inválido", async () => {
    const { calls } = useRouteClient([]);

    expect(await listFewShotExamples(ctx, supplierId, 0)).toEqual([]);
    expect(await listFewShotExamples(ctx, "x")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("scans.server · purgeExpiredScans", () => {
  it("borra con el cliente admin las filas anteriores al corte y devuelve ids y rutas", async () => {
    const { calls, client } = fakeClient([
      ok([
        { id: "a", storage_path: "s1/a.jpg" },
        { id: "b", storage_path: "s2/b.jpg" },
      ]),
    ]);

    const result = await purgeExpiredScans(
      client as unknown as Parameters<typeof purgeExpiredScans>[0],
      90,
      new Date("2026-10-15T12:00:00.000Z"),
    );

    expect(result).toEqual({ deletedIds: ["a", "b"], storagePaths: ["s1/a.jpg", "s2/b.jpg"] });
    expect(calls[0]).toEqual([
      ["from", "invoice_scans"],
      ["delete"],
      ["lt", "created_at", "2026-07-17T12:00:00.000Z"],
      ["select", "id, storage_path"],
    ]);
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
  });

  it("propaga el error de Supabase", async () => {
    const { client } = fakeClient([{ data: null, error: { code: "42501", message: "denied" } }]);

    await expect(
      purgeExpiredScans(client as unknown as Parameters<typeof purgeExpiredScans>[0]),
    ).rejects.toBeInstanceOf(Error);
  });
});
