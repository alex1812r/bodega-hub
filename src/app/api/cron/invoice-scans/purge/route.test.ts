/** @jest-environment node */

import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import * as mock from "@/modules/invoice-scan/server/scans.mock-server";
import * as server from "@/modules/invoice-scan/server/scans.server";
import { removeInvoiceObjects } from "@/modules/invoice-scan/server/storage";

import { GET, POST } from "./route";

jest.mock("../../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));
jest.mock("../../../../../modules/invoice-scan/server/scans.server", () => ({
  purgeExpiredScans: jest.fn(),
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
const mockedPurge = jest.mocked(server.purgeExpiredScans);
const mockedRemove = jest.mocked(removeInvoiceObjects);

function authorized(method: "GET" | "POST" = "GET") {
  return new Request(URL, { headers: { authorization: `Bearer ${SECRET}` }, method });
}

type PurgeBody = { data: { deleted: number; objects: number } };

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
    expect(mockedPurge).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  describe("mock data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
    });

    it("purges only scans older than 90 days", async () => {
      const ctx = { storeId: "store-purge", userId: "user-1" };
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });

      jest.setSystemTime(new Date(NOW.getTime() - 91 * DAY_MS));
      const old = await mock.insertScan(ctx, {
        imageSha256: SHA_OLD,
        model: "m",
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
      expect(body.data).toEqual({ deleted: 1, objects: 1 });
      expect(await mock.getScan(ctx, old.id)).toBeNull();
      expect(await mock.getScan(ctx, recent.id)).not.toBeNull();
    });
  });

  describe("supabase data source", () => {
    const calls: string[] = [];
    const lt = jest.fn();
    const list = jest.fn();

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      calls.length = 0;
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"], now: NOW });

      lt.mockResolvedValue({
        data: [
          { storage_path: `store-1/${SHA_OLD}/p1.jpg` },
          { storage_path: `store-2/${SHA_NEW}/p1.webp` },
        ],
        error: null,
      });
      list.mockImplementation(async (folder: string) => ({
        data:
          folder === `store-1/${SHA_OLD}`
            ? [{ name: "p1.jpg" }, { name: "p2.png" }]
            : [{ name: "p1.webp" }],
        error: null,
      }));
      mockedAdmin.mockReturnValue({
        from: () => ({ select: () => ({ lt }) }),
        storage: { from: () => ({ list }) },
      } as unknown as ReturnType<typeof createAdminSupabaseClient>);
      mockedRemove.mockImplementation(async () => {
        calls.push("storage");
      });
      mockedPurge.mockImplementation(async () => {
        calls.push("rows");
        return { deletedIds: ["scan-1", "scan-2"], storagePaths: [] };
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
        `store-1/${SHA_OLD}/p2.png`,
        `store-2/${SHA_NEW}/p1.webp`,
      ]);
      expect(mockedPurge).toHaveBeenCalledWith(expect.anything(), 90, NOW);
    });

    it("keeps the rows when Storage removal fails", async () => {
      mockedRemove.mockRejectedValue(new ApiError(503, "INTERNAL_ERROR", "Storage caído"));

      const response = await GET(authorized());

      expect(response.status).toBe(503);
      expect(mockedPurge).not.toHaveBeenCalled();
    });

    it("keeps the rows when listing a scan folder fails", async () => {
      list.mockResolvedValue({ data: null, error: { message: "boom" } });

      const response = await GET(authorized());

      expect(response.status).toBe(503);
      expect(mockedRemove).not.toHaveBeenCalled();
      expect(mockedPurge).not.toHaveBeenCalled();
    });
  });
});
