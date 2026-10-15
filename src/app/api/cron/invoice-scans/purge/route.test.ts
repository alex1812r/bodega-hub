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

const URL = "http://localhost/api/cron/invoice-scans/purge";
const SECRET = "test-cron-secret";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T12:00:00.000Z");
const SHA_OLD = "a".repeat(64);
const SHA_NEW = "b".repeat(64);

const mockedAdmin = jest.mocked(createAdminSupabaseClient);
const mockedRemove = jest.mocked(removeInvoiceObjects);

function authorized(method: "GET" | "POST" = "GET") {
  return new Request(URL, { headers: { authorization: `Bearer ${SECRET}` }, method });
}

type PurgeBody = { data: { deleted: number; objects: number } };
type ExpiredRow = { id: string; pages: number; storage_path: string };

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
      const old = await mock.insertScan(ctx, {
        imageSha256: SHA_OLD,
        model: "m",
        pages: 3,
        provider: "p",
        storagePath: `store-purge/${SHA_OLD}/p1.jpg`,
      });

      jest.setSystemTime(new Date(NOW.getTime() - 89 * DAY_MS));
      const recent = await mock.insertScan(ctx, {
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
  });

  describe("supabase data source", () => {
    const calls: string[] = [];
    const lt = jest.fn();
    const deleteIn = jest.fn();

    function useExpiredRows(rows: ExpiredRow[]) {
      lt.mockResolvedValue({ data: rows, error: null });
    }

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      calls.length = 0;
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"], now: NOW });

      useExpiredRows([
        { id: "scan-1", pages: 2, storage_path: `store-1/${SHA_OLD}/p1.jpg` },
        { id: "scan-2", pages: 1, storage_path: `store-2/${SHA_NEW}/p1.webp` },
      ]);
      deleteIn.mockImplementation((_column: string, ids: string[]) => ({
        select: async () => {
          calls.push("rows");
          return { data: ids.map((id) => ({ id })), error: null };
        },
      }));
      mockedAdmin.mockReturnValue({
        from: () => ({ delete: () => ({ in: deleteIn }), select: () => ({ lt }) }),
      } as unknown as ReturnType<typeof createAdminSupabaseClient>);
      mockedRemove.mockImplementation(async () => {
        calls.push("storage");
      });
    });

    it("removes every page from Storage before deleting the rows", async () => {
      const response = await GET(authorized());
      const body = (await response.json()) as PurgeBody;

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ deleted: 2, objects: 3 });
      expect(calls).toEqual(["storage", "rows"]);
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
      useExpiredRows([{ id: "scan-3", pages: 3, storage_path: `store-1/${SHA_OLD}/p1.png` }]);

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
  });
});
