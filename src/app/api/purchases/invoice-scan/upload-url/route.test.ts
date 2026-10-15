/**
 * @jest-environment node
 */

jest.mock("../../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const HASH = "a".repeat(64);

function request(query: string, headers: Record<string, string> = { "x-demo-role": "almacen" }) {
  return new Request(`http://localhost/api/purchases/invoice-scan/upload-url?${query}`, { headers });
}

describe("GET /api/purchases/invoice-scan/upload-url", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  afterEach(() => {
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

  it("en supabase firma una URL por página con un solo tipo para todas", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    const createSignedUploadUrl = jest.fn(async (path: string) => ({
      data: { path, signedUrl: `https://firma/${path}`, token: `t-${path}` },
      error: null,
    }));
    const from = jest.fn(() => ({ createSignedUploadUrl }));
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({ storage: { from } });

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
});
