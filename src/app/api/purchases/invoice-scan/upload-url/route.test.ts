/**
 * @jest-environment node
 */

jest.mock("../../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import { INVOICE_SCAN_REAL_SESSION_MESSAGE } from "@/modules/invoice-scan/server/requireScanSession";
import { resetMockScanStore, seedScanForTest } from "@/modules/invoice-scan/server/scans.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const HASH = "a".repeat(64);

/** Cliente service role falso: `from("invoice_scans")` devuelve `liveScan` y `storage` firma subidas. */
function adminClient(liveScan: Record<string, unknown> | null = null, existing: readonly string[] = []) {
  const createSignedUploadUrl = jest.fn(async (path: string) =>
    existing.includes(path)
      ? {
          data: null,
          // Lo que devuelve Storage al firmar una ruta que ya existe sin upsert.
          error: Object.assign(new Error("The resource already exists"), {
            code: "KeyAlreadyExists",
            status: 400,
            statusCode: "409",
          }),
        }
      : { data: { path, signedUrl: `https://firma/${path}`, token: `t-${path}` }, error: null },
  );
  const storageFrom = jest.fn(() => ({ createSignedUploadUrl }));
  const query = {
    eq: () => query,
    in: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: liveScan, error: null }),
    select: () => query,
  };
  const client = { from: jest.fn(() => query), storage: { from: storageFrom } };
  (createAdminSupabaseClient as jest.Mock).mockReturnValue(client);
  return { client, createSignedUploadUrl, storageFrom };
}

const ALMACEN_PROFILE = {
  deniedPermissions: [],
  grantedPermissions: [],
  id: "f2120000-0000-4000-8000-000000000001",
  isActive: true,
  name: "Almacén",
  role: "almacen",
  storeId: DEFAULT_STORE_ID,
};

function request(query: string, headers: Record<string, string> = { "x-demo-role": "almacen" }) {
  return new Request(`http://localhost/api/purchases/invoice-scan/upload-url?${query}`, { headers });
}

describe("GET /api/purchases/invoice-scan/upload-url", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  afterEach(() => {
    resetMockScanStore();
    process.env.API_DATA_SOURCE = originalDataSource;
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("responde 401 sin sesión", async () => {
    process.env.ALLOW_DEMO_AUTH = "false";

    const response = await GET(request(`sha256=${HASH}&pages=1&types=image/jpeg`));

    expect(response.status).toBe(401);
  });

  it("responde 403 sin purchases.create", async () => {
    const response = await GET(
      request(`sha256=${HASH}&pages=1&types=image/jpeg`, { "x-demo-role": "contador" }),
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ["hash inválido", `sha256=${"z".repeat(64)}&pages=1&types=image/jpeg`],
    ["hash en mayúsculas", `sha256=${"A".repeat(64)}&pages=1&types=image/jpeg`],
    ["más de 10 páginas", `sha256=${HASH}&pages=11&types=image/jpeg`],
    ["cero páginas", `sha256=${HASH}&pages=0&types=image/jpeg`],
    ["tipo no permitido", `sha256=${HASH}&pages=1&types=application/pdf`],
    ["tipos que no cuadran con las páginas", `sha256=${HASH}&pages=3&types=image/jpeg,image/webp`],
    ["tipos mezclados (el POST exige un solo formato)", `sha256=${HASH}&pages=2&types=image/jpeg,image/webp`],
    ["sin parámetros", ""],
  ])("responde 400 por %s", async (_label, query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
  });

  it("en mock devuelve URLs deterministas bajo la tienda de la sesión", async () => {
    const response = await GET(
      request(`sha256=${HASH}&pages=2&types=image/jpeg,image/jpeg`, {
        "x-demo-role": "almacen",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.uploads).toEqual([
      {
        page: 1,
        path: `${DEFAULT_STORE_ID}/${HASH}/p1.jpg`,
        signedUrl: expect.stringContaining("mock-upload.local"),
        token: expect.any(String),
      },
      {
        page: 2,
        path: `${DEFAULT_STORE_ID}/${HASH}/p2.jpg`,
        signedUrl: expect.stringContaining("mock-upload.local"),
        token: expect.any(String),
      },
    ]);

    const again = await (
      await GET(request(`sha256=${HASH}&pages=2&types=image/jpeg,image/jpeg`))
    ).json();
    expect(again).toEqual(body);
  });

  it("ignora un store_id del cliente: la ruta sale de la sesión", async () => {
    const response = await GET(
      request(`sha256=${HASH}&pages=1&types=image/jpeg&storeId=otra-tienda`),
    );
    const body = await response.json();

    expect(body.data.uploads[0].path.startsWith(`${DEFAULT_STORE_ID}/`)).toBe(true);
  });

  it("en supabase, anon con cabeceras demo no firma subidas en otra tienda: 401 (caos-4 M2)", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    process.env.ALLOW_DEMO_AUTH = "true";
    (createAdminSupabaseClient as jest.Mock).mockClear();

    const response = await GET(
      request(`sha256=${HASH}&pages=1&types=image/jpeg`, {
        "x-demo-role": "admin",
        "x-demo-store-id": "00000000-0000-4000-8000-000000000001",
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_REAL_SESSION_MESSAGE);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("en supabase firma una URL por página con un solo tipo para todas", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(ALMACEN_PROFILE);
    const { storageFrom: from } = adminClient();

    const response = await GET(request(`sha256=${HASH}&pages=2&types=image/jpeg`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("invoice-scans");
    expect(body.data.uploads.map((upload: { path: string }) => upload.path)).toEqual([
      `${DEFAULT_STORE_ID}/${HASH}/p1.jpg`,
      `${DEFAULT_STORE_ID}/${HASH}/p2.jpg`,
    ]);
    expect(body.data.uploads[0]).toMatchObject({
      signedUrl: `https://firma/${DEFAULT_STORE_ID}/${HASH}/p1.jpg`,
      token: `t-${DEFAULT_STORE_ID}/${HASH}/p1.jpg`,
    });
  });

  it.each(["processing", "extracted", "confirmed"])(
    "en supabase no firma si ya hay un escaneo %s de la tienda con ese hash: alreadyUploaded con sus rutas (M3)",
    async (status) => {
      process.env.API_DATA_SOURCE = "supabase";
      (getAuthProfileFromSession as jest.Mock).mockResolvedValue(ALMACEN_PROFILE);
      const firstPage = `${DEFAULT_STORE_ID}/${HASH}/p1.jpg`;
      const { createSignedUploadUrl } = adminClient({
        id: "11111111-1111-4111-8111-111111111111",
        pages: 2,
        status,
        storage_path: firstPage,
      });

      const response = await GET(request(`sha256=${HASH}&pages=2&types=image/jpeg`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(createSignedUploadUrl).not.toHaveBeenCalled();
      expect(body.data).toEqual({
        alreadyUploaded: true,
        storagePaths: [firstPage, `${DEFAULT_STORE_ID}/${HASH}/p2.jpg`],
        uploads: [],
      });
    },
  );

  it("en supabase sin escaneo vivo firma y marca alreadyUploaded false", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(ALMACEN_PROFILE);
    const { createSignedUploadUrl } = adminClient(null);

    const body = await (await GET(request(`sha256=${HASH}&pages=1&types=image/jpeg`))).json();

    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1);
    expect(body.data.alreadyUploaded).toBe(false);
    expect(body.data.uploads).toHaveLength(1);
  });

  it("en supabase sin escaneo vivo pero con todas las páginas en el bucket: alreadyUploaded, no 503 (REP-03-F1)", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(ALMACEN_PROFILE);
    const paths = [`${DEFAULT_STORE_ID}/${HASH}/p1.jpg`, `${DEFAULT_STORE_ID}/${HASH}/p2.jpg`];
    adminClient(null, paths);

    const response = await GET(request(`sha256=${HASH}&pages=2&types=image/jpeg`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ alreadyUploaded: true, storagePaths: paths, uploads: [] });
  });

  it("en supabase con solo algunas páginas en el bucket firma las que faltan y devuelve todas las rutas (REP-03-F1)", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(ALMACEN_PROFILE);
    const paths = [`${DEFAULT_STORE_ID}/${HASH}/p1.jpg`, `${DEFAULT_STORE_ID}/${HASH}/p2.jpg`];
    adminClient(null, [paths[0]!]);

    const response = await GET(request(`sha256=${HASH}&pages=2&types=image/jpeg`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      alreadyUploaded: false,
      storagePaths: paths,
      uploads: [{ page: 2, path: paths[1], signedUrl: `https://firma/${paths[1]}`, token: `t-${paths[1]}` }],
    });
  });

  it("en mock tampoco firma si ya hay un escaneo vivo con ese hash en la tienda (M3)", async () => {
    const firstPage = `${DEFAULT_STORE_ID}/${HASH}/p1.jpg`;
    await seedScanForTest(
      { storeId: DEFAULT_STORE_ID, userId: "otro-usuario" },
      { imageSha256: HASH, model: "m", provider: "mock", storagePath: firstPage },
    );

    const body = await (await GET(request(`sha256=${HASH}&pages=1&types=image/jpeg`))).json();

    expect(body.data).toEqual({ alreadyUploaded: true, storagePaths: [firstPage], uploads: [] });
  });
});
