/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

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
  markScanFailed,
  reserveScan,
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
    usage_pages: 1,
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
    for (const method of ["select", "insert", "update", "delete", "eq", "gte", "in", "lt", "not", "order", "limit"]) {
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

describe("scans.server · reserveScan", () => {
  const input = {
    imageSha256: "a".repeat(64),
    limit: 50,
    model: "m",
    pages: 2,
    provider: "mock",
    storagePath: `${ctx.storeId}/${"a".repeat(64)}/p1.jpg`,
  };

  function useRpc(result: Result) {
    const rpc = jest.fn(async () => result);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });
    return rpc;
  }

  it("llama a reserve_invoice_scan con los parámetros (la tienda sale del JWT) y valida la respuesta", async () => {
    const rpc = useRpc(ok({ id: scanId, limit: 50, outcome: "reserved", used: 7 }));

    await expect(reserveScan(ctx, input)).resolves.toEqual({ id: scanId, limit: 50, outcome: "reserved", used: 7 });
    expect(rpc).toHaveBeenCalledWith("reserve_invoice_scan", {
      p_limit: 50,
      p_model: "m",
      p_pages: 2,
      p_provider: "mock",
      p_sha256: input.imageSha256,
      p_storage_path: input.storagePath,
    });
  });

  it.each([
    [{ id: scanId, outcome: "cached" }],
    [{ id: scanId, outcome: "in_progress" }],
    [{ limit: 50, outcome: "quota", used: 49 }],
  ])("devuelve %o tal cual", async (data) => {
    useRpc(ok(data));

    await expect(reserveScan(ctx, input)).resolves.toEqual(data);
  });

  it("propaga el error de la RPC (42501 para un rol sin permiso)", async () => {
    useRpc({ data: null, error: { code: "42501", message: "No tienes permiso para escanear facturas." } });

    await expect(reserveScan(ctx, input)).rejects.toBeTruthy();
  });

  it("rechaza una respuesta con otra forma", async () => {
    useRpc(ok({ outcome: "otro" }));

    await expect(reserveScan(ctx, input)).rejects.toThrow();
  });
});

describe("scans.server · completeScan / failScan", () => {
  const completion = {
    durationMs: 900,
    extracted: { confidence: 1, currency: "VES" as const, lines: [], supplier: { name: "Alfa" }, warnings: [] },
    inputTokens: 10,
    matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
    model: "m",
    outputTokens: 20,
    provider: "mock",
  };

  it("completeScan pasa la fila de processing a extracted en la tienda", async () => {
    const { calls } = useRouteClient([ok(dbRow())]);

    expect(await completeScan(ctx, scanId, completion)).toMatchObject({ id: scanId, status: "extracted" });
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["eq", "id", scanId],
        ["eq", "store_id", ctx.storeId],
        ["eq", "status", "processing"],
      ]),
    );
    const update = calls[0].find(([method]) => method === "update");
    expect(update?.[1]).toMatchObject({ error: null, input_tokens: 10, status: "extracted" });
  });

  it("completeScan devuelve null si la fila ya no está processing", async () => {
    useRouteClient([ok(null)]);

    expect(await completeScan(ctx, scanId, completion)).toBeNull();
  });

  it("failScan deja failed con el código y la lectura vacía, solo desde processing", async () => {
    const { calls } = useRouteClient([ok(null)]);

    await failScan(ctx, scanId, "TIMEOUT");

    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["update", { error: "TIMEOUT", extracted: {}, matched: {}, status: "failed" }],
        ["eq", "store_id", ctx.storeId],
        ["eq", "status", "processing"],
      ]),
    );
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
  it("suma usage_pages (cada intento cobrado) en el rango [00:00, 24:00) de Caracas del día de `now`", async () => {
    const { calls } = useRouteClient([ok([{ usage_pages: 2 }, { usage_pages: 1 }, { usage_pages: 3 }])]);

    // 23:30 del 14-oct en Caracas.
    const usage = await getDailyUsage(ctx, 5, new Date("2026-10-15T03:30:00.000Z"));

    expect(usage).toEqual({ limit: 5, remaining: 0, used: 6 });
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ["select", "usage_pages"],
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

type AdminClient = Parameters<typeof listExpiredScans>[0];

describe("scans.server · purga a 90 días", () => {
  const sha = "a".repeat(64);

  it("listExpiredScans lee sin borrar y deriva las rutas de todas las páginas", async () => {
    const { calls, client } = fakeClient([
      ok([
        { id: "a", pages: 3, storage_path: `s1/${sha}/p1.png` },
        { id: "b", pages: 1, storage_path: "s2/legacy.jpg" },
      ]),
    ]);

    const result = await listExpiredScans(
      client as unknown as AdminClient,
      90,
      new Date("2026-10-15T12:00:00.000Z"),
      100,
    );

    expect(result).toEqual([
      { id: "a", storagePaths: [`s1/${sha}/p1.png`, `s1/${sha}/p2.png`, `s1/${sha}/p3.png`] },
      { id: "b", storagePaths: ["s2/legacy.jpg"] },
    ]);
    expect(calls[0]).toEqual([
      ["from", "invoice_scans"],
      ["select", "id, storage_path, pages"],
      ["lt", "created_at", "2026-07-17T12:00:00.000Z"],
      ["order", "created_at", { ascending: true }],
      ["limit", 100],
    ]);
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
  });

  it("deleteScansByIds borra solo los ids indicados y cuenta las filas", async () => {
    const { calls, client } = fakeClient([ok([{ id: "a" }, { id: "b" }])]);

    expect(await deleteScansByIds(client as unknown as AdminClient, ["a", "b"])).toBe(2);
    expect(calls[0]).toEqual([
      ["from", "invoice_scans"],
      ["delete"],
      ["in", "id", ["a", "b"]],
      ["select", "id"],
    ]);
  });

  it("deleteScansByIds sin ids no consulta", async () => {
    const { client } = fakeClient([]);

    expect(await deleteScansByIds(client as unknown as AdminClient, [])).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("propaga el error de Supabase", async () => {
    const { client } = fakeClient([{ data: null, error: { code: "42501", message: "denied" } }]);

    await expect(
      listExpiredScans(client as unknown as AdminClient, 90, new Date(), 100),
    ).rejects.toBeInstanceOf(Error);
  });

  it("listExpiredScanObjects llama a la RPC con el corte y el límite y devuelve los nombres", async () => {
    const rpc = jest.fn(async () => ok([{ name: `s1/${sha}/p1.jpg` }, { name: `s1/${sha}/p2.jpg` }]));
    const { client } = fakeClient([]);

    const result = await listExpiredScanObjects(
      { ...client, rpc } as unknown as AdminClient,
      90,
      new Date("2026-10-15T12:00:00.000Z"),
      100,
    );

    expect(result).toEqual([`s1/${sha}/p1.jpg`, `s1/${sha}/p2.jpg`]);
    expect(rpc).toHaveBeenCalledWith("list_expired_invoice_scan_objects", {
      p_before: "2026-07-17T12:00:00.000Z",
      p_limit: 100,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("listExpiredScanObjects propaga el error de la RPC", async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { code: "42501", message: "denied" } }));

    await expect(
      listExpiredScanObjects({ rpc } as unknown as AdminClient, 90, new Date(), 100),
    ).rejects.toBeInstanceOf(Error);
  });
});
