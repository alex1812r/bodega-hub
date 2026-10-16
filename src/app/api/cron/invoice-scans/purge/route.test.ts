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

    it("purges only scans older than 90 days and counts every page", async () => {
      jest.setSystemTime(new Date(NOW.getTime() - 91 * DAY_MS));
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
    const rpc = jest.fn();
    let table: ExpiredRow[] = [];
    /** Objetos del bucket de más de 90 días sin escaneo vivo (lo que devuelve la RPC). */
    let orphans: string[] = [];

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      calls.length = 0;
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"], now: NOW });

      table = [
        { id: "scan-1", pages: 2, storage_path: `store-1/${SHA_OLD}/p1.jpg` },
        { id: "scan-2", pages: 1, storage_path: `store-2/${SHA_NEW}/p1.webp` },
      ];
      limit.mockImplementation(async (count: number) => {
        calls.push("list");
        return { data: table.slice(0, count), error: null };
      });
      lt.mockReturnValue({ order: () => ({ limit }) });
      orphans = [];
      rpc.mockImplementation(async (_fn: string, args: { p_limit: number }) => {
        calls.push("orphans");
        return { data: orphans.slice(0, args.p_limit).map((name) => ({ name })), error: null };
      });
      deleteIn.mockImplementation((_column: string, ids: string[]) => ({
        select: async () => {
          calls.push("rows");
          const deleted = table.filter((row) => ids.includes(row.id));
          table = table.filter((row) => !ids.includes(row.id));
          return { data: deleted.map(({ id }) => ({ id })), error: null };
        },
      }));
      mockedAdmin.mockReturnValue({
        from: () => ({ delete: () => ({ in: deleteIn }), select: () => ({ lt }) }),
        rpc,
      } as unknown as ReturnType<typeof createAdminSupabaseClient>);
      mockedRemove.mockImplementation(async (_client, paths) => {
        calls.push("storage");
        orphans = orphans.filter((name) => !paths.includes(name));
      });
    });

    it("purges a 91-day object that never got a row (upload-url without a successful POST)", async () => {
      table = [];
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
      expect(orphans).toEqual([]);
    });

    it("removes every page from Storage before deleting the rows", async () => {
      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2, objects: 3 });
      expect(calls).toEqual(["list", "storage", "rows", "orphans"]);
      expect(lt).toHaveBeenCalledWith(
        "created_at",
        new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
      );
      expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), [
        `store-1/${SHA_OLD}/p1.jpg`,
        `store-1/${SHA_OLD}/p2.jpg`,
        `store-2/${SHA_NEW}/p1.webp`,
      ]);
      expect(deleteIn).toHaveBeenCalledWith("id", ["scan-1", "scan-2"]);
    });

    it("removes the three objects of a three-page scan", async () => {
      table = [{ id: "scan-3", pages: 3, storage_path: `store-1/${SHA_OLD}/p1.png` }];

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

    it("keeps the rows when Storage removal fails", async () => {
      mockedRemove.mockRejectedValue(new ApiError(503, "INTERNAL_ERROR", "Storage caído"));

      const response = await GET(authorized());

      expect(response.status).toBe(503);
      expect(deleteIn).not.toHaveBeenCalled();
    });

    it("purges 250 expired scans in three batches: list, Storage and rows per batch", async () => {
      table = expiredRows(250);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 250, objects: 250 });
      expect(calls).toEqual(["list", "storage", "rows", "list", "storage", "rows", "list", "storage", "rows", "orphans"]);
      expect(limit.mock.calls.map(([count]) => count)).toEqual([100, 100, 100]);
      expect(mockedRemove.mock.calls.map(([, paths]) => paths.length)).toEqual([100, 100, 50]);
      expect(deleteIn.mock.calls.map(([, ids]) => (ids as string[]).length)).toEqual([100, 100, 50]);
      expect(table).toEqual([]);
    });

    it("stops at the batch whose Storage removal fails and keeps that batch's rows", async () => {
      table = expiredRows(250);
      mockedRemove
        .mockImplementationOnce(async () => undefined)
        .mockRejectedValueOnce(new ApiError(503, "INTERNAL_ERROR", "Storage caído"));

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeErrorBody;

      expect(response.status).toBe(503);
      expect(body.error.details).toEqual({ deleted: 100, objects: 100 });
      expect(deleteIn).toHaveBeenCalledTimes(1);
      expect(table).toHaveLength(150);
      expect(table[0].id).toBe("scan-101");
    });

    it("caps a run at 20 batches and leaves the rest for the next run", async () => {
      table = expiredRows(2050);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2000, objects: 2000 });
      expect(limit).toHaveBeenCalledTimes(20);
      expect(table).toHaveLength(50);
    });

    it("purges orphan objects after the rows, in batches of at most 100, and adds them to objects", async () => {
      orphans = Array.from({ length: 250 }, (_, index) => `store-1/${index.toString(16).padStart(64, "0")}/p1.jpg`);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2, objects: 3 + 250 });
      expect(calls).toEqual([
        "list", "storage", "rows",
        "orphans", "storage", "orphans", "storage", "orphans", "storage",
      ]);
      expect(rpc.mock.calls.map(([, args]) => (args as { p_limit: number }).p_limit)).toEqual([100, 100, 100]);
      expect(mockedRemove.mock.calls.map(([, paths]) => paths.length)).toEqual([3, 100, 100, 50]);
      expect(orphans).toEqual([]);
    });

    it("caps the orphan phase at 20 batches too", async () => {
      table = [];
      orphans = Array.from({ length: 2050 }, (_, index) => `store-1/${index.toString(16).padStart(64, "0")}/p1.jpg`);

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 0, objects: 2000 });
      expect(rpc).toHaveBeenCalledTimes(20);
      expect(orphans).toHaveLength(50);
    });

    it("answers 503 with what was already purged when Storage fails on orphans", async () => {
      orphans = [`store-1/${"c".repeat(64)}/p1.jpg`];
      mockedRemove
        .mockImplementationOnce(async () => {
          calls.push("storage");
        })
        .mockRejectedValueOnce(new ApiError(503, "INTERNAL_ERROR", "Storage caído"));

      const response = await GET(authorized());
      const body = (await response.json()) as PurgeErrorBody;

      expect(response.status).toBe(503);
      expect(body.error.details).toEqual({ deleted: 2, objects: 3 });
      expect(orphans).toHaveLength(1);
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

    it("removes a 91-day orphan and keeps the old image of a live (retried) scan", async () => {
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
      expect(await mock.listExpiredScanObjects(null, 90, new Date(NOW.getTime() + 91 * DAY_MS), 100)).toEqual([
        liveImage,
      ]);
    });
  });
});
