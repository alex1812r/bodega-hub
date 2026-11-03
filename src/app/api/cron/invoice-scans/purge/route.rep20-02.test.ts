/** @jest-environment node */

/**
 * REP20-02 (B-p21A-1, D78(b)): la purga vuelve a comprobar la antigüedad al
 * borrar. N64a: un reescaneo reserva la fila vencida entre la lista y el
 * borrado. N64b: upload-url (o el POST del escaneo con storagePaths) reutiliza un
 * objeto huérfano vencido entre la lista y el borrado de Storage.
 */
import { POST as scanPost } from "@/app/api/purchases/invoice-scan/route";
import { GET as uploadUrl } from "@/app/api/purchases/invoice-scan/upload-url/route";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";
import { mockInvoiceStorage } from "@/modules/invoice-scan/server/scanService";
import * as mock from "@/modules/invoice-scan/server/scans.mock-server";
import { removeInvoiceObjects, sha256OfPages } from "@/modules/invoice-scan/server/storage";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

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
  return {
    ...actual,
    listExpiredScanObjects: jest.fn(actual.listExpiredScanObjects),
    listExpiredScans: jest.fn(actual.listExpiredScans),
    removeScanObjects: jest.fn(actual.removeScanObjects),
  };
});

const actualMock = jest.requireActual<typeof import("@/modules/invoice-scan/server/scans.mock-server")>(
  "../../../../../modules/invoice-scan/server/scans.mock-server",
);

const SECRET = "rep20-02-secret";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-03T12:00:00.000Z");
const OLD = new Date(NOW.getTime() - 91 * DAY_MS);
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const mockedListScans = jest.mocked(mock.listExpiredScans);
const mockedListObjects = jest.mocked(mock.listExpiredScanObjects);
const mockedRemoveMock = jest.mocked(mock.removeScanObjects);
const mockedAdmin = jest.mocked(createAdminSupabaseClient);
const mockedRemove = jest.mocked(removeInvoiceObjects);

function purge() {
  return POST(
    new Request("http://localhost/api/cron/invoice-scans/purge", {
      headers: { authorization: `Bearer ${SECRET}` },
      method: "POST",
    }),
  );
}

function askUploadUrl(sha256: string) {
  return uploadUrl(
    new Request(`http://localhost/api/purchases/invoice-scan/upload-url?sha256=${sha256}&pages=1&types=image/jpeg`, {
      headers: { "x-demo-role": "almacen" },
    }),
  );
}

describe("purga · TOCTOU (REP20-02, B-p21A-1)", () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    jest.clearAllMocks();
    mock.resetMockScanStore();
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"], now: NOW });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    process.env.API_DATA_SOURCE = originalSource;
    jest.useRealTimers();
  });

  describe("mock", () => {
    const ctx = { storeId: DEFAULT_STORE_ID, userId: "user-rep20-02" };

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
    });

    it("N64a: no borra la fila ni la imagen que un reescaneo reservó entre la lista y el borrado", async () => {
      const path = `${DEFAULT_STORE_ID}/${SHA_A}/p1.jpg`;
      jest.setSystemTime(OLD);
      const old = await mock.seedScanForTest(ctx, {
        imageSha256: SHA_A,
        model: "m",
        provider: "p",
        storagePath: path,
      });
      await mock.discardScan(ctx, old.id);
      mock.seedScanObjectForTest(path, OLD.toISOString());
      jest.setSystemTime(NOW);
      mockedListScans.mockImplementationOnce(async (...args) => {
        const listed = await actualMock.listExpiredScans(...args);
        // El reescaneo de la misma foto la reserva: created_at = hoy, processing.
        await mock.reserveScan(ctx, { imageSha256: SHA_A, limit: 50, model: "m", pages: 1, provider: "p", storagePath: path });
        return listed;
      });

      const response = await purge();

      expect(response.status).toBe(200);
      expect((await mock.getScan(ctx, old.id))?.status).toBe("processing");
      expect(mockedRemoveMock.mock.calls.flatMap(([, paths]) => paths)).not.toContain(path);
    });

    it("N64b: upload-url no reutiliza un huérfano que la purga ya listó; tras la purga firma una subida nueva", async () => {
      const path = `${DEFAULT_STORE_ID}/${SHA_B}/p1.jpg`;
      mock.seedScanObjectForTest(path, OLD.toISOString());
      let duringPurge = 0;
      mockedListObjects.mockImplementationOnce(async (...args) => {
        const listed = await actualMock.listExpiredScanObjects(...args);
        const response = await askUploadUrl(SHA_B);
        duringPurge = response.status;
        if (response.ok) {
          // El POST del escaneo de hoy sobre el objeto reutilizado.
          await mock.seedScanForTest(ctx, { imageSha256: SHA_B, model: "m", provider: "p", storagePath: path });
        }
        return listed;
      });

      const response = await purge();
      const removed = mockedRemoveMock.mock.calls.flatMap(([, paths]) => paths);
      const rowCreated = mock.listMockScansOfStore(DEFAULT_STORE_ID).some((scan) => scan.imageSha256 === SHA_B);

      expect(response.status).toBe(200);
      expect({ duringPurge, removed, rowCreated }).toEqual({
        duringPurge: 503,
        removed: expect.arrayContaining([path]),
        rowCreated: false,
      });
      expect((await askUploadUrl(SHA_B)).status).toBe(200);
    });

    it("N64b: el POST con storagePaths de un huérfano que la purga ya listó responde 503 sin crear fila", async () => {
      const image = jpegHeader(800, 600, "rep20-02-post");
      const sha = sha256OfPages([image]);
      const path = `${DEFAULT_STORE_ID}/${sha}/p1.jpg`;
      await mockInvoiceStorage.upload(path, image, "image/jpeg");
      mock.seedScanObjectForTest(path, OLD.toISOString());
      let duringPurge = 0;
      mockedListObjects.mockImplementationOnce(async (...args) => {
        const listed = await actualMock.listExpiredScanObjects(...args);
        // Un cliente que ya tenía las rutas (upload-url de otro día) manda el POST.
        const response = await scanPost(
          new Request("http://localhost/api/purchases/invoice-scan", {
            body: JSON.stringify({ sha256: sha, storagePaths: [path] }),
            headers: { "content-type": "application/json", "x-demo-role": "almacen" },
            method: "POST",
          }),
        );
        duringPurge = response.status;
        return listed;
      });

      const response = await purge();
      const rowCreated = mock.listMockScansOfStore(DEFAULT_STORE_ID).some((scan) => scan.imageSha256 === sha);

      expect(response.status).toBe(200);
      expect({ duringPurge, rowCreated }).toEqual({ duringPurge: 503, rowCreated: false });
      expect(mockedRemoveMock.mock.calls.flatMap(([, paths]) => paths)).toContain(path);
    });
  });

  describe("supabase", () => {
    type Row = {
      id: string;
      created_at: string;
      status: string;
      pages: number;
      storage_path: string;
      last_used_at?: string;
      claimed_at?: string;
    };
    let table: Row[];
    /** Lo que pasa en la base entre la lista de la purga y su borrado. */
    let afterList: () => void;

    /** `from("invoice_scans")`: aplica los filtros in / lt al leer o al borrar. */
    function fakeTable() {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "delete" = "select";
      const matching = () => table.filter((row) => filters.every((filter) => filter(row)));
      const builder = {
        delete: () => {
          mode = "delete";
          return builder;
        },
        in: (column: keyof Row, values: string[]) => {
          filters.push((row) => values.includes(String(row[column])));
          return builder;
        },
        limit: async (count: number) => {
          const data = matching().slice(0, count);
          afterList();
          return { data, error: null };
        },
        lt: (column: keyof Row, value: string) => {
          filters.push((row) => String(row[column]) < value);
          return builder;
        },
        // `col.is.null,col.lt.<corte>` (sin uso desde el corte): la columna nula o anterior.
        or: (expression: string) => {
          const [, column, value] = /^(\w+)\.is\.null,\1\.lt\.(.+)$/.exec(expression) ?? [];
          if (!column || value === undefined) {
            throw new Error(`or() inesperado: ${expression}`);
          }
          filters.push((row) => {
            const cell = row[column as keyof Row];
            return cell === undefined || cell === null || String(cell) < value;
          });
          return builder;
        },
        order: () => builder,
        select: () => {
          if (mode === "select") {
            return builder;
          }
          const deleted = matching();
          table = table.filter((row) => !deleted.includes(row));
          return Promise.resolve({ data: deleted.map(({ id }) => ({ id })), error: null });
        },
      };
      return builder;
    }

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      afterList = () => undefined;
      mockedAdmin.mockReturnValue({
        from: () => fakeTable(),
        rpc: jest.fn(async () => ({ data: [], error: null })),
      } as unknown as ReturnType<typeof createAdminSupabaseClient>);
      mockedRemove.mockResolvedValue(undefined);
    });

    it("N64a: el DELETE vuelve a mirar created_at y no borra la fila ni la imagen reservadas hoy", async () => {
      const path = `store-1/${SHA_A}/p1.jpg`;
      table = [{ created_at: OLD.toISOString(), id: "scan-a", pages: 1, status: "discarded", storage_path: path }];
      afterList = () => {
        // reserve_invoice_scan del reescaneo: created_at = hoy, processing.
        table = table.map((row) => ({ ...row, created_at: NOW.toISOString(), status: "processing" }));
      };

      const response = await purge();

      expect(response.status).toBe(200);
      expect(table.map(({ id, status }) => ({ id, status }))).toEqual([{ id: "scan-a", status: "processing" }]);
      expect(mockedRemove.mock.calls.flatMap(([, paths]) => paths)).not.toContain(path);
    });

    it.each(["last_used_at", "claimed_at"] as const)(
      "N64c (B-q2005-2): una fila vencida con %s de hoy (reabierta desde la caché o reclamada) no se lista ni se borra",
      async (column) => {
        const used = `store-1/${SHA_A}/p1.jpg`;
        const idle = `store-1/${SHA_B}/p1.jpg`;
        table = [
          { created_at: OLD.toISOString(), id: "scan-used", pages: 1, status: "extracted", storage_path: used, [column]: NOW.toISOString() },
          { created_at: OLD.toISOString(), id: "scan-idle", pages: 1, status: "extracted", storage_path: idle },
        ];

        const response = await purge();

        expect(response.status).toBe(200);
        expect((await response.json()).data.deleted).toBe(1);
        expect(table.map(({ id }) => id)).toEqual(["scan-used"]);
      },
    );
  });
});
