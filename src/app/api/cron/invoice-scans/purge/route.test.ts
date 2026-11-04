/** @jest-environment node */

import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import * as mock from "@/modules/invoice-scan/server/scans.mock-server";
import { removeInvoiceObjects } from "@/modules/invoice-scan/server/storage";

import { GET, POST } from "./route";

jest.mock("../../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));
jest.mock("../../../../../modules/invoice-scan/server/storage", () => ({
  ...jest.requireActual<typeof import("@/modules/invoice-scan/server/storage")>(
    "../../../../../modules/invoice-scan/server/storage",
  ),
  removeInvoiceObjects: jest.fn(),
}));
jest.mock("../../../../../modules/invoice-scan/server/scans.mock-server", () => {
  const actual = jest.requireActual<typeof import("@/modules/invoice-scan/server/scans.mock-server")>(
    "../../../../../modules/invoice-scan/server/scans.mock-server",
  );
  return { ...actual, listExpiredScans: jest.fn(actual.listExpiredScans) };
});

const URL = "http://localhost/api/cron/invoice-scans/purge";
const SECRET = "test-cron-secret";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T12:00:00.000Z");
const SHA_OLD = "a".repeat(64);
const SHA_NEW = "b".repeat(64);

const mockedAdmin = jest.mocked(createAdminSupabaseClient);
const mockedRemove = jest.mocked(removeInvoiceObjects);
const mockedListExpired = jest.mocked(mock.listExpiredScans);

function authorized(method: "GET" | "POST" = "GET") {
  return new Request(URL, { headers: { authorization: `Bearer ${SECRET}` }, method });
}

type PurgeBody = { data: { deleted: number; objects: number } };
type PurgeErrorBody = { error: { details: { deleted: number; objects: number } } };
type ExpiredRow = { id: string; pages: number; storage_path: string };

function expiredRows(count: number): ExpiredRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `scan-${index + 1}`,
    pages: 1,
    storage_path: `store-1/${index.toString(16).padStart(64, "0")}/p1.jpg`,
  }));
}

describe("/api/cron/invoice-scans/purge", () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    process.env.API_DATA_SOURCE = originalSource;
    jest.useRealTimers();
  });

  it("rejects requests without the cron secret", async () => {
    const response = await GET(new Request(URL));

    expect(response.status).toBe(401);
    expect(mockedAdmin).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  describe("mock data source", () => {
    const ctx = { storeId: "store-purge", userId: "user-1" };

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    });

    it("purges only scans older than 90 days and then every page of the purged one", async () => {
      jest.setSystemTime(new Date(NOW.getTime() - 91 * DAY_MS));
      for (const page of [1, 2, 3]) {
        mock.seedScanObjectForTest(`store-purge/${SHA_OLD}/p${page}.jpg`, new Date().toISOString());
      }
      const old = await mock.seedScanForTest(ctx, {
        imageSha256: SHA_OLD,
        model: "m",
        pages: 3,
        provider: "p",
        storagePath: `store-purge/${SHA_OLD}/p1.jpg`,
      });

      jest.setSystemTime(new Date(NOW.getTime() - 89 * DAY_MS));
      const recent = await mock.seedScanForTest(ctx, {
        imageSha256: SHA_NEW,
        model: "m",
        provider: "p",
        storagePath: `store-purge/${SHA_NEW}/p1.jpg`,
      });

      jest.setSystemTime(NOW);
      const response = await POST(authorized("POST"));
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 1, objects: 3 });
      expect(await mock.getScan(ctx, old.id)).toBeNull();
      expect(await mock.getScan(ctx, recent.id)).not.toBeNull();
    });

    it("purges 250 expired scans in three batches of at most 100", async () => {
      const batchCtx = { storeId: "store-batches", userId: "user-1" };
      jest.setSystemTime(new Date(NOW.getTime() - 91 * DAY_MS));
      const ids: string[] = [];
      for (let index = 0; index < 250; index += 1) {
        const sha = `c${index.toString(16).padStart(63, "0")}`;
        const scan = await mock.seedScanForTest(batchCtx, {
          imageSha256: sha,
          model: "m",
          provider: "p",
          storagePath: `store-batches/${sha}/p1.jpg`,
        });
        mock.seedScanObjectForTest(`store-batches/${sha}/p1.jpg`, new Date().toISOString());
        ids.push(scan.id);
      }

      jest.setSystemTime(NOW);
      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 250, objects: 250 });
      expect(mockedListExpired.mock.calls.map((call) => call[3])).toEqual([100, 100, 100]);
      for (const id of ids) {
        expect(await mock.getScan(batchCtx, id)).toBeNull();
      }
    });
  });

  describe("supabase data source", () => {
    const calls: string[] = [];
    const lt = jest.fn();
    const limit = jest.fn();
    const deleteIn = jest.fn();
    const deleteLt = jest.fn();
    const rpc = jest.fn();
    let table: ExpiredRow[] = [];
    /** Objetos del bucket de más de 90 días que nunca tuvieron fila. */
    let orphans: string[] = [];
    /** Objetos de las filas, que siguen en el bucket hasta la fase de huérfanos. */
    let rowObjects: string[] = [];

    const folderOf = (path: string) => path.split("/").slice(0, 2).join("/");
    const pagesOf = (row: ExpiredRow) =>
      Array.from({ length: row.pages }, (_, index) => row.storage_path.replace("/p1.", `/p${index + 1}.`));
    /** Lo que lista la RPC: objetos del bucket sin fila en su carpeta. */
    const listable = () => {
      const folders = new Set(table.map((row) => folderOf(row.storage_path)));
      return [...rowObjects, ...orphans].filter((name) => !folders.has(folderOf(name)));
    };
    const rpcCalls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      calls.length = 0;
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"], now: NOW });

      table = [
        { id: "scan-1", pages: 2, storage_path: `store-1/${SHA_OLD}/p1.jpg` },
        { id: "scan-2", pages: 1, storage_path: `store-2/${SHA_NEW}/p1.webp` },
      ];
      rowObjects = table.flatMap(pagesOf);
      limit.mockImplementation(async (count: number) => {
        calls.push("list");
        return { data: table.slice(0, count).map(({ id }) => ({ id })), error: null };
      });
      // Los dos .or() de «sin uso desde el corte» (last_used_at / claimed_at) no filtran aquí.
      lt.mockReturnValue({ or: () => ({ or: () => ({ order: () => ({ limit }) }) }) });
      orphans = [];
      rpc.mockImplementation(async (fn: string, args: { p_limit: number }) => {
        if (fn === "release_invoice_scan_object_claims") {
          calls.push("release");
          return { data: null, error: null };
        }
        calls.push("orphans");
        return { data: listable().slice(0, args.p_limit).map((name) => ({ name })), error: null };
      });
      deleteIn.mockImplementation((_column: string, ids: string[]) => ({
        lt: (...args: unknown[]) => {
          deleteLt(...args);
          const select = async () => {
            calls.push("rows");
            const deleted = table.filter((row) => ids.includes(row.id));
            table = table.filter((row) => !ids.includes(row.id));
            return { data: deleted.map(({ id }) => ({ id })), error: null };
          };
          return { or: () => ({ or: () => ({ select }) }) };
        },
      }));
      mockedAdmin.mockReturnValue({
        from: () => ({ delete: () => ({ in: deleteIn }), select: () => ({ lt }) }),
        rpc,
      } as unknown as ReturnType<typeof createAdminSupabaseClient>);
      mockedRemove.mockImplementation(async (_client, paths) => {
        calls.push("storage");
        orphans = orphans.filter((name) => !paths.includes(name));
        rowObjects = rowObjects.filter((name) => !paths.includes(name));
      });
    });

    it("purges a 91-day object that never got a row (upload-url without a successful POST) and releases its claim", async () => {
      table = [];
      rowObjects = [];
      const orphan = `store-1/${SHA_OLD}/p1.jpg`;
      orphans = [orphan];

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 0, objects: 1 });
      expect(rpc).toHaveBeenCalledWith("list_expired_invoice_scan_objects", {
        p_before: new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
        p_limit: 100,
      });
      expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), [orphan]);
      expect(rpc).toHaveBeenCalledWith("release_invoice_scan_object_claims", { p_names: [orphan] });
      expect(orphans).toEqual([]);
    });

    it("deletes the rows re-checking created_at in the same DELETE, then removes their pages as orphans (D78(b))", async () => {
      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;
      const cutoff = new Date(NOW.getTime() - 90 * DAY_MS).toISOString();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2, objects: 3 });
      expect(calls).toEqual(["list", "rows", "orphans", "storage", "release"]);
      expect(lt).toHaveBeenCalledWith("created_at", cutoff);
      expect(deleteIn).toHaveBeenCalledWith("id", ["scan-1", "scan-2"]);
      expect(deleteLt).toHaveBeenCalledWith("created_at", cutoff);
      expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), [
        `store-1/${SHA_OLD}/p1.jpg`,
        `store-1/${SHA_OLD}/p2.jpg`,
        `store-2/${SHA_NEW}/p1.webp`,
      ]);
    });

    it("removes the three objects of a three-page scan", async () => {
      table = [{ id: "scan-3", pages: 3, storage_path: `store-1/${SHA_OLD}/p1.png` }];
      rowObjects = table.flatMap(pagesOf);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 1, objects: 3 });
      expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), [
        `store-1/${SHA_OLD}/p1.png`,
        `store-1/${SHA_OLD}/p2.png`,
        `store-1/${SHA_OLD}/p3.png`,
      ]);
    });

    it("keeps the objects without releasing their claim when Storage removal fails: the next run retries them as orphans", async () => {
      mockedRemove.mockRejectedValue(new ApiError(503, "INTERNAL_ERROR", "Storage caído"));

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeErrorBody;

      expect(response.status).toBe(503);
      expect(body.error.details).toEqual({ deleted: 2, objects: 0 });
      expect(rpcCalls("release_invoice_scan_object_claims")).toHaveLength(0);
      expect(listable()).toHaveLength(3);
    });

    it("purges 250 expired scans: rows in three batches, then their objects in three orphan batches", async () => {
      table = expiredRows(250);
      rowObjects = table.flatMap(pagesOf);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 250, objects: 250 });
      expect(calls).toEqual([
        "list", "rows", "list", "rows", "list", "rows",
        "orphans", "storage", "release", "orphans", "storage", "release", "orphans", "storage", "release",
      ]);
      expect(limit.mock.calls.map(([count]) => count)).toEqual([100, 100, 100]);
      expect(deleteIn.mock.calls.map(([, ids]) => (ids as string[]).length)).toEqual([100, 100, 50]);
      expect(mockedRemove.mock.calls.map(([, paths]) => paths.length)).toEqual([100, 100, 50]);
      expect(table).toEqual([]);
    });

    it("stops at the orphan batch whose Storage removal fails and reports what was already purged", async () => {
      table = expiredRows(250);
      rowObjects = table.flatMap(pagesOf);
      mockedRemove
        .mockImplementationOnce(async (_client, paths) => {
          rowObjects = rowObjects.filter((name) => !paths.includes(name));
        })
        .mockRejectedValueOnce(new ApiError(503, "INTERNAL_ERROR", "Storage caído"));

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeErrorBody;

      expect(response.status).toBe(503);
      expect(body.error.details).toEqual({ deleted: 250, objects: 100 });
      expect(rpcCalls("release_invoice_scan_object_claims")).toHaveLength(1);
      expect(rowObjects).toHaveLength(150);
    });

    it("caps a run at 20 batches and leaves the rest (rows and their objects) for the next run", async () => {
      table = expiredRows(2050);
      rowObjects = table.flatMap(pagesOf);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2000, objects: 2000 });
      expect(limit).toHaveBeenCalledTimes(20);
      expect(table).toHaveLength(50);
      expect(rowObjects).toHaveLength(50);
    });

    it("purges orphan objects after the rows, in batches of at most 100, and adds them to objects", async () => {
      orphans = Array.from({ length: 250 }, (_, index) => `store-1/${index.toString(16).padStart(64, "0")}/p1.jpg`);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2, objects: 3 + 250 });
      expect(calls).toEqual([
        "list", "rows",
        "orphans", "storage", "release", "orphans", "storage", "release", "orphans", "storage", "release",
      ]);
      expect(rpcCalls("list_expired_invoice_scan_objects").map(([, args]) => (args as { p_limit: number }).p_limit)).toEqual([
        100, 100, 100,
      ]);
      expect(mockedRemove.mock.calls.map(([, paths]) => paths.length)).toEqual([100, 100, 53]);
      expect(orphans).toEqual([]);
    });

    it("caps the orphan phase at 20 batches too", async () => {
      table = [];
      rowObjects = [];
      orphans = Array.from({ length: 2050 }, (_, index) => `store-1/${index.toString(16).padStart(64, "0")}/p1.jpg`);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 0, objects: 2000 });
      expect(rpcCalls("list_expired_invoice_scan_objects")).toHaveLength(20);
      expect(orphans).toHaveLength(50);
    });
  });

  describe("mock data source: objects without a row", () => {
    const ctx = { storeId: "store-orphans", userId: "user-1" };
    const SHA_LIVE = "d".repeat(64);
    const SHA_ORPHAN = "e".repeat(64);

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"], now: NOW });
    });

    it("removes a 91-day orphan and keeps the old image of a scan that still has its row", async () => {
      const old = new Date(NOW.getTime() - 91 * DAY_MS).toISOString();
      const orphan = `store-orphans/${SHA_ORPHAN}/p1.jpg`;
      const liveImage = `store-orphans/${SHA_LIVE}/p1.jpg`;
      mock.seedScanObjectForTest(orphan, old);
      mock.seedScanObjectForTest(liveImage, old);
      await mock.seedScanForTest(ctx, {
        imageSha256: SHA_LIVE,
        model: "m",
        provider: "p",
        storagePath: liveImage,
      });

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 0, objects: 1 });
      expect(await mock.listExpiredScanObjects(null, 90, NOW, 100)).toEqual([]);
      // D78(b): mientras la fila exista su imagen no se lista, aunque la fila ya haya vencido;
      // se lista cuando la fase de filas la borra.
      expect(await mock.listExpiredScanObjects(null, 90, new Date(NOW.getTime() + 91 * DAY_MS), 100)).toEqual([]);
    });
  });
});
