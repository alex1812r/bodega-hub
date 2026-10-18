/**
 * @jest-environment node
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertPathInStore,
  createInvoiceSignedReadUrl,
  createInvoiceUploadUrls,
  createMockInvoiceUploadUrls,
  downloadInvoicePage,
  INVOICE_MAX_BYTES,
  INVOICE_MAX_PAGES,
  INVOICE_MAX_SIDE,
  INVOICE_SCANS_BUCKET,
  INVOICE_STORAGE_UNAVAILABLE_MESSAGE,
  invoiceScanPath,
  removeInvoiceObjects,
  sha256Hex,
  sha256OfPages,
  uploadInvoicePage,
} from "./storage";

const STORE = "00000000-0000-4000-8000-000000000001";
const HASH = "0123456789abcdef".repeat(4);
const PATH = `${STORE}/${HASH}/p1.jpg`;

type Bucket = Record<string, jest.Mock>;

function clientWith(bucket: Bucket) {
  const from = jest.fn(() => bucket);
  return { client: { storage: { from } } as unknown as Pick<SupabaseClient, "storage">, from };
}

const UNAVAILABLE = { code: "INTERNAL_ERROR", message: INVOICE_STORAGE_UNAVAILABLE_MESSAGE, status: 503 };

describe("invoice-scan storage", () => {
  it("expone los límites del plan", () => {
    expect(INVOICE_SCANS_BUCKET).toBe("invoice-scans");
    expect(INVOICE_MAX_BYTES).toBe(1_048_576);
    expect(INVOICE_MAX_SIDE).toBe(1600);
    expect(INVOICE_MAX_PAGES).toBe(10);
  });

  describe("invoiceScanPath", () => {
    it("arma <store>/<sha>/p<n>.<ext> por tipo", () => {
      expect(invoiceScanPath(STORE, HASH, 1, "image/jpeg")).toBe(PATH);
      expect(invoiceScanPath(STORE, HASH, 2, "image/webp")).toBe(`${STORE}/${HASH}/p2.webp`);
      expect(invoiceScanPath(STORE, HASH, 10, "image/png")).toBe(`${STORE}/${HASH}/p10.png`);
    });

    it.each([
      ["store con barra", "a/b", HASH, 1],
      ["store con ..", "..", HASH, 1],
      ["hash corto", STORE, "abc", 1],
      ["página 0", STORE, HASH, 0],
      ["página decimal", STORE, HASH, 1.5],
    ])("rechaza %s", (_label, store, hash, page) => {
      expect(() => invoiceScanPath(store, hash, page, "image/jpeg")).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    });
  });

  describe("assertPathInStore", () => {
    it("acepta una ruta propia", () => {
      expect(() => assertPathInStore(PATH, STORE)).not.toThrow();
    });

    it.each([
      ["otra tienda", `otra-tienda/${HASH}/p1.jpg`],
      ["traversal", `${STORE}/../otra/${HASH}/p1.jpg`],
      ["traversal en el archivo", `${STORE}/${HASH}/..`],
      ["barra inicial", `/${STORE}/${HASH}/p1.jpg`],
      ["barra doble", `${STORE}//${HASH}/p1.jpg`],
      ["segmento extra", `${STORE}/${HASH}/x/p1.jpg`],
      ["extensión rara", `${STORE}/${HASH}/p1.exe`],
      ["nombre raro", `${STORE}/${HASH}/factura.jpg`],
      ["prefijo parecido", `${STORE}x/${HASH}/p1.jpg`],
      ["vacía", ""],
    ])("rechaza %s", (_label, path) => {
      expect(() => assertPathInStore(path, STORE)).toThrow(expect.objectContaining({ status: 400 }));
    });
  });

  describe("hash", () => {
    it("sha256Hex coincide con el vector conocido", () => {
      expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });

    it("sha256OfPages es el hash de la concatenación en orden", () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([4, 5]);

      expect(sha256OfPages([a, b])).toBe(sha256Hex(new Uint8Array([1, 2, 3, 4, 5])));
      expect(sha256OfPages([b, a])).not.toBe(sha256OfPages([a, b]));
    });
  });

  describe("createInvoiceUploadUrls", () => {
    it("firma cada página sin upsert: un objeto existente no se puede reemplazar (M3)", async () => {
      const createSignedUploadUrl = jest.fn(async (path: string) => ({
        data: { path, signedUrl: `https://firma/${path}`, token: "tok" },
        error: null,
      }));
      const { client, from } = clientWith({ createSignedUploadUrl });

      const uploads = await createInvoiceUploadUrls(client, STORE, HASH, [
        { mediaType: "image/jpeg", page: 1 },
        { mediaType: "image/webp", page: 2 },
      ]);

      expect(from).toHaveBeenCalledWith(INVOICE_SCANS_BUCKET);
      expect(createSignedUploadUrl).toHaveBeenCalledWith(PATH, { upsert: false });
      expect(uploads).toEqual([
        { page: 1, path: PATH, signedUrl: `https://firma/${PATH}`, token: "tok" },
        {
          page: 2,
          path: `${STORE}/${HASH}/p2.webp`,
          signedUrl: `https://firma/${STORE}/${HASH}/p2.webp`,
          token: "tok",
        },
      ]);
    });

    it("una página que ya existe (Duplicate 409 al firmar) vuelve marcada como existente, sin URL (REP-03-F1)", async () => {
      // Forma real de @supabase/storage-js: StorageApiError con status HTTP 400 y statusCode "409".
      const duplicate = Object.assign(new Error("The resource already exists"), {
        code: "KeyAlreadyExists",
        status: 400,
        statusCode: "409",
      });
      const createSignedUploadUrl = jest.fn(async (path: string) =>
        path.endsWith("p1.jpg")
          ? { data: null, error: duplicate }
          : { data: { path, signedUrl: `https://firma/${path}`, token: "tok" }, error: null },
      );
      const { client } = clientWith({ createSignedUploadUrl });

      const uploads = await createInvoiceUploadUrls(client, STORE, HASH, [
        { mediaType: "image/jpeg", page: 1 },
        { mediaType: "image/jpeg", page: 2 },
      ]);

      expect(uploads).toEqual([
        { alreadyExists: true, page: 1, path: PATH },
        { page: 2, path: `${STORE}/${HASH}/p2.jpg`, signedUrl: `https://firma/${STORE}/${HASH}/p2.jpg`, token: "tok" },
      ]);
    });

    it("traduce el error de Storage a 503 sin el detalle interno", async () => {
      const { client } = clientWith({
        createSignedUploadUrl: jest.fn(async () => ({ data: null, error: { message: "Bucket not found" } })),
      });

      const promise = createInvoiceUploadUrls(client, STORE, HASH, [{ mediaType: "image/jpeg", page: 1 }]);

      await expect(promise).rejects.toMatchObject(UNAVAILABLE);
      await expect(promise).rejects.not.toMatchObject({ message: expect.stringContaining("Bucket") });
    });

    it("si Storage lanza responde 503", async () => {
      const { client } = clientWith({
        createSignedUploadUrl: jest.fn(async () => {
          throw new TypeError("fetch failed");
        }),
      });

      await expect(
        createInvoiceUploadUrls(client, STORE, HASH, [{ mediaType: "image/jpeg", page: 1 }]),
      ).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  it("createMockInvoiceUploadUrls es determinista", () => {
    const pages = [{ mediaType: "image/jpeg" as const, page: 1 }];

    expect(createMockInvoiceUploadUrls(STORE, HASH, pages)).toEqual(
      createMockInvoiceUploadUrls(STORE, HASH, pages),
    );
    expect(createMockInvoiceUploadUrls(STORE, HASH, pages)[0]?.path).toBe(PATH);
  });

  describe("uploadInvoicePage", () => {
    it("sube con el content-type indicado", async () => {
      const upload = jest.fn(async () => ({ data: { path: PATH }, error: null }));
      const { client } = clientWith({ upload });
      const data = new Uint8Array([1]);

      await uploadInvoicePage(client, PATH, data, "image/jpeg");

      expect(upload).toHaveBeenCalledWith(PATH, data, { contentType: "image/jpeg", upsert: true });
    });

    it("error de Storage → 503", async () => {
      const { client } = clientWith({
        upload: jest.fn(async () => ({ data: null, error: { message: "quota" } })),
      });

      await expect(uploadInvoicePage(client, PATH, new Uint8Array([1]), "image/jpeg")).rejects.toMatchObject(
        UNAVAILABLE,
      );
    });
  });

  describe("downloadInvoicePage", () => {
    it("devuelve los bytes del objeto", async () => {
      const { client } = clientWith({
        download: jest.fn(async () => ({ data: new Blob([new Uint8Array([7, 8])]), error: null })),
      });

      await expect(downloadInvoicePage(client, PATH)).resolves.toEqual(new Uint8Array([7, 8]));
    });

    it("objeto inexistente → 404", async () => {
      const { client } = clientWith({
        download: jest.fn(async () => ({ data: null, error: { message: "Object not found", status: 400, statusCode: "404" } })),
      });

      await expect(downloadInvoicePage(client, PATH)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });

    it("otro fallo → 503", async () => {
      const { client } = clientWith({
        download: jest.fn(async () => ({ data: null, error: { message: "boom", status: 500, statusCode: "500" } })),
      });

      await expect(downloadInvoicePage(client, PATH)).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe("createInvoiceSignedReadUrl", () => {
    it("devuelve la URL firmada con la caducidad pedida", async () => {
      const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: "https://leer" }, error: null }));
      const { client } = clientWith({ createSignedUrl });

      await expect(createInvoiceSignedReadUrl(client, PATH, 60)).resolves.toBe("https://leer");
      expect(createSignedUrl).toHaveBeenCalledWith(PATH, 60);
    });

    it("error → 503", async () => {
      const { client } = clientWith({
        createSignedUrl: jest.fn(async () => ({ data: null, error: { message: "x" } })),
      });

      await expect(createInvoiceSignedReadUrl(client, PATH, 60)).rejects.toMatchObject(UNAVAILABLE);
    });

    it("objeto inexistente → 404, no 503 (C6)", async () => {
      const { client } = clientWith({
        createSignedUrl: jest.fn(async () => ({
          data: null,
          error: { message: "Object not found", status: 400, statusCode: "404" },
        })),
      });

      await expect(createInvoiceSignedReadUrl(client, PATH, 60)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    });
  });

  describe("removeInvoiceObjects", () => {
    it("borra las rutas indicadas y no llama a Storage si no hay ninguna", async () => {
      const remove = jest.fn(async () => ({ data: [], error: null }));
      const { client } = clientWith({ remove });

      await removeInvoiceObjects(client, []);
      expect(remove).not.toHaveBeenCalled();

      await removeInvoiceObjects(client, [PATH]);
      expect(remove).toHaveBeenCalledWith([PATH]);
    });

    it("error → 503", async () => {
      const { client } = clientWith({ remove: jest.fn(async () => ({ data: null, error: { message: "x" } })) });

      await expect(removeInvoiceObjects(client, [PATH])).rejects.toMatchObject(UNAVAILABLE);
    });
  });
});
