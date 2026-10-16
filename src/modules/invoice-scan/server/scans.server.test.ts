/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  completeScan,
  discardScan,
  failScan,
  findConfirmedScanByPurchase,
  getDailyUsage,
  getProductNames,
  getScan,
  listFewShotExamples,
  deleteScansByIds,
  listExpiredScanObjects,
  listExpiredScans,
  reserveScan,
} from "./scans.server";

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Call = [method: string, ...args: unknown[]];

const ctx = { storeId: "00000000-0000-4000-8000-000000000001", userId: "44444444-4444-4444-8444-444444444444" };
const scanId = "11111111-1111-4111-8111-111111111111";
const attemptId = "55555555-5555-4555-8555-555555555555";
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

  /** reserve_invoice_scan solo la ejecuta service_role (20261019i): cliente admin, nunca el del usuario. */
  function useRpc(result: Result) {
    const rpc = jest.fn(async () => result);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({ rpc });
    return rpc;
  }

  it("llama a reserve_invoice_scan con el cliente service role, la tienda y el usuario de la sesión (C1/C3)", async () => {
    const reserved = { attemptId, id: scanId, limit: 50, outcome: "reserved", used: 7 };
    const rpc = useRpc(ok(reserved));

    await expect(reserveScan(ctx, input)).resolves.toEqual(reserved);
    expect(rpc).toHaveBeenCalledWith("reserve_invoice_scan", {
      p_limit: 50,
      p_model: "m",
      p_pages: 2,
      p_provider: "mock",
      p_sha256: input.imageSha256,
      p_storage_path: input.storagePath,
      p_store_id: ctx.storeId,
      p_user_id: ctx.userId,
    });
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
  });

  it("rechaza un reserved sin attemptId", async () => {
    useRpc(ok({ id: scanId, limit: 50, outcome: "reserved", used: 7 }));

    await expect(reserveScan(ctx, input)).rejects.toThrow();
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

describe("scans.server · completeScan / failScan / discardScan por RPC service role (SCN-03l, SCN-03n)", () => {
  const completion = {
    durationMs: 900,
    extracted: { confidence: 1, currency: "VES" as const, lines: [], supplier: { name: "Alfa" }, warnings: [] },
    inputTokens: 10,
    matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
    outputTokens: 20,
  };

  /** Cliente sin `from`: authenticated ya no puede escribir la tabla, solo por RPC (20261019g). */
  function useRpcClient(result: Result) {
    const calls: Call[] = [];
    const builder: Record<string, unknown> = {
      maybeSingle: () => {
        calls.push(["maybeSingle"]);
        return Promise.resolve(result);
      },
      select: (...args: unknown[]) => {
        calls.push(["select", ...args]);
        return builder;
      },
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    const rpc = jest.fn((...args: unknown[]) => {
      calls.push(["rpc", ...args]);
      return builder;
    });
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({ rpc });
    return calls;
  }

  afterEach(() => {
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
  });

  it("completeScan llama a complete_invoice_scan con tienda, usuario e intento y devuelve la fila extracted", async () => {
    const calls = useRpcClient(ok(dbRow()));

    expect(await completeScan(ctx, scanId, attemptId, completion)).toMatchObject({ id: scanId, status: "extracted" });
    expect(calls[0]).toEqual([
      "rpc",
      "complete_invoice_scan",
      {
        p_attempt_id: attemptId,
        p_duration_ms: 900,
        p_extracted: completion.extracted,
        p_id: scanId,
        p_input_tokens: 10,
        p_matched: completion.matched,
        p_output_tokens: 20,
        p_store_id: ctx.storeId,
        p_user_id: ctx.userId,
      },
    ]);
    expect(calls).toContainEqual(["maybeSingle"]);
  });

  it("completeScan devuelve null si la fila ya no existe (la RPC no devuelve filas)", async () => {
    useRpcClient(ok(null));

    expect(await completeScan(ctx, scanId, attemptId, completion)).toBeNull();
  });

  it("completeScan propaga el 409 de un intento que ya no está vigente (PT409, C1/C2)", async () => {
    useRpcClient({ data: null, error: { code: "PT409", message: "Esta lectura ya no está vigente." } });

    await expect(completeScan(ctx, scanId, attemptId, completion)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Esta lectura ya no está vigente.",
      status: 409,
    });
  });

  it("failScan llama a fail_invoice_scan con tienda, usuario, intento y código, sin reembolso por defecto", async () => {
    const calls = useRpcClient(ok(null));

    await failScan(ctx, scanId, attemptId, "TIMEOUT");

    expect(calls[0]).toEqual([
      "rpc",
      "fail_invoice_scan",
      {
        p_attempt_id: attemptId,
        p_error: "TIMEOUT",
        p_id: scanId,
        p_refund_pages: false,
        p_store_id: ctx.storeId,
        p_user_id: ctx.userId,
      },
    ]);
  });

  it("failScan con reembolso cuando el fallo es anterior al modelo", async () => {
    const calls = useRpcClient(ok(null));

    await failScan(ctx, scanId, attemptId, "UPLOAD_ERROR", true);

    expect(calls[0]).toEqual([
      "rpc",
      "fail_invoice_scan",
      {
        p_attempt_id: attemptId,
        p_error: "UPLOAD_ERROR",
        p_id: scanId,
        p_refund_pages: true,
        p_store_id: ctx.storeId,
        p_user_id: ctx.userId,
      },
    ]);
  });

  it("discardScan llama a discard_invoice_scan con la tienda; null (404) si no hay fila o el id no es uuid", async () => {
    const calls = useRpcClient(ok(dbRow({ status: "discarded" })));
    expect(await discardScan(ctx, scanId)).toMatchObject({ status: "discarded" });
    expect(calls[0]).toEqual(["rpc", "discard_invoice_scan", { p_id: scanId, p_store_id: ctx.storeId }]);

    useRpcClient(ok(null));
    expect(await discardScan(ctx, scanId)).toBeNull();

    const none = useRpcClient(ok(null));
    expect(await discardScan(ctx, "no-uuid")).toBeNull();
    expect(none).toHaveLength(0);
  });

  it("discardScan propaga el 409 de la RPC (PT409) con su mensaje por estado", async () => {
    const message = "Este escaneo todavía se está leyendo; espera a que termine para descartarlo.";
    useRpcClient({ data: null, error: { code: "PT409", message } });

    await expect(discardScan(ctx, scanId)).rejects.toMatchObject({ code: "CONFLICT", message, status: 409 });
  });
});

describe("scans.server · getScan", () => {
  it("getScan filtra por tienda; null si no es de la tienda o el id no es uuid", async () => {
    const { calls } = useRouteClient([ok(null)]);

    expect(await getScan(ctx, scanId)).toBeNull();
    expect(calls[0]).toEqual(expect.arrayContaining([["eq", "store_id", ctx.storeId]]));
    expect(await getScan(ctx, "no-uuid")).toBeNull();
    expect(calls).toHaveLength(1);
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
  const extraction = { confidence: 1, currency: "USD", lines: [], supplier: { name: "Alfa" }, warnings: [] };

  it("pide confirmados del proveedor en la tienda, recientes primero, máximo 3, y usa confirmed.extraction (D10)", async () => {
    const confirmed = { extraction, lines: [{ lineIndex: 0, packLabel: "caja", productId: "p1", unitsPerPack: 12 }] };
    const { calls } = useRouteClient([ok([{ confirmed, id: scanId, storage_path: "p.jpg" }])]);

    const examples = await listFewShotExamples(ctx, supplierId, 10);

    expect(examples).toEqual([{ extraction, scanId, storagePath: "p.jpg" }]);
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

  it("ignora la forma vieja y el JSON roto registrando solo el código (D10)", async () => {
    const secret = "PROVEEDOR SECRETO";
    useRouteClient([
      ok([
        { confirmed: { ...extraction, supplier: { name: secret } }, id: "s-legacy", storage_path: "a.jpg" },
        { confirmed: `{"extraction": "${secret}`, id: "s-broken", storage_path: "b.jpg" },
        { confirmed: { extraction: { supplier: secret }, lines: "x" }, id: "s-garbage", storage_path: "c.jpg" },
        { confirmed: { extraction, lines: [] }, id: scanId, storage_path: "p.jpg" },
      ]),
    ]);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const examples = await listFewShotExamples(ctx, supplierId);

      expect(examples).toEqual([{ extraction, scanId, storagePath: "p.jpg" }]);
      expect(warn.mock.calls).toEqual(
        Array.from({ length: 3 }, () => ["[invoice-scan] confirmed fuera del contrato", { code: "INVALID_CONFIRMED_SCAN" }]),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
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

describe("scans.server · escaneo de una compra (SCN-09a)", () => {
  const purchaseId = "66666666-6666-4666-8666-666666666666";
  const productId = "77777777-7777-4777-8777-777777777777";

  it("findConfirmedScanByPurchase comprueba la compra en la tienda y busca su escaneo confirmado más reciente", async () => {
    const { calls } = useRouteClient([
      ok({ id: purchaseId }),
      ok(dbRow({ confirmed_at: "2026-10-15T13:00:00.000Z", purchase_id: purchaseId, status: "confirmed" })),
    ]);

    const result = await findConfirmedScanByPurchase(ctx, purchaseId);

    expect(result.purchaseFound).toBe(true);
    expect(result.scan).toMatchObject({ id: scanId, purchaseId, status: "confirmed" });
    expect(calls[0]).toEqual(
      expect.arrayContaining([["from", "purchases"], ["eq", "id", purchaseId], ["eq", "store_id", ctx.storeId]]),
    );
    expect(calls[1]).toEqual(
      expect.arrayContaining([
        ["from", "invoice_scans"],
        ["eq", "store_id", ctx.storeId],
        ["eq", "purchase_id", purchaseId],
        ["eq", "status", "confirmed"],
        ["order", "confirmed_at", { ascending: false }],
        ["limit", 1],
      ]),
    );
  });

  it("findConfirmedScanByPurchase: compra ajena o id no uuid → purchaseFound false sin buscar escaneo", async () => {
    const { calls } = useRouteClient([ok(null)]);

    expect(await findConfirmedScanByPurchase(ctx, purchaseId)).toEqual({ purchaseFound: false, scan: null });
    expect(await findConfirmedScanByPurchase(ctx, "no-uuid")).toEqual({ purchaseFound: false, scan: null });
    expect(calls).toHaveLength(1);
  });

  it("findConfirmedScanByPurchase: compra sin escaneo → scan null", async () => {
    useRouteClient([ok({ id: purchaseId }), ok(null)]);

    expect(await findConfirmedScanByPurchase(ctx, purchaseId)).toEqual({ purchaseFound: true, scan: null });
  });

  it("getProductNames filtra por tienda e ids únicos; sin ids válidos no consulta", async () => {
    const { calls } = useRouteClient([ok([{ id: productId, name: "Harina PAN" }])]);

    expect(await getProductNames(ctx, [productId, productId, "no-uuid"])).toEqual({ [productId]: "Harina PAN" });
    expect(calls[0]).toEqual(
      expect.arrayContaining([["from", "products"], ["eq", "store_id", ctx.storeId], ["in", "id", [productId]]]),
    );
    expect(await getProductNames(ctx, ["no-uuid"])).toEqual({});
    expect(calls).toHaveLength(1);
  });
});
