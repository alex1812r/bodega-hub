/**
 * @jest-environment node
 */
import { sha256OfPages } from "@/modules/invoice-scan/server/storage";

import { POST as scan } from "../route";
import { GET } from "./route";

const URL_BASE = "http://localhost/api/purchases/invoice-scan";

let counter = 0;

function fresh() {
  counter += 1;
  return { image: `detalle-${counter}-${Date.now()}`, storeId: `route-detail-${counter}` };
}

async function createScan(storeId: string, pages: string[]) {
  const form = new FormData();
  pages.forEach((text) => form.append("page", new File([text], "p.webp", { type: "image/webp" })));
  const response = await scan(
    new Request(URL_BASE, {
      body: form,
      headers: { "x-demo-role": "almacen", "x-demo-store-id": storeId },
      method: "POST",
    }),
  );

  return ((await response.json()) as { data: { scanId: string } }).data.scanId;
}

function get(id: string, storeId: string, role = "almacen") {
  return GET(
    new Request(`${URL_BASE}/${id}`, { headers: { "x-demo-role": role, "x-demo-store-id": storeId } }),
    { params: Promise.resolve({ id }) },
  );
}

describe("GET /api/purchases/invoice-scan/[id]", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("devuelve el escaneo con una URL de lectura falsa por página en mock", async () => {
    const { image, storeId } = fresh();
    const pages = [`${image}-1`, `${image}-2`];
    const sha = sha256OfPages(pages.map((text) => new TextEncoder().encode(text)));
    const id = await createScan(storeId, pages);

    const response = await get(id, storeId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      createdAt: expect.any(String),
      extraction: { lines: expect.any(Array) },
      matched: { lines: expect.any(Array) },
      pages: 2,
      scanId: id,
      status: "extracted",
    });
    expect(body.data.imageUrls).toEqual([
      expect.stringContaining(`mock-storage.local/storage/v1/object/sign/invoice-scans/${storeId}/${sha}/p1.webp`),
      expect.stringContaining(`${storeId}/${sha}/p2.webp`),
    ]);
  });

  it("un rol con purchases.view pero sin purchases.create puede leerlo", async () => {
    const { image, storeId } = fresh();
    const id = await createScan(storeId, [image]);

    expect((await get(id, storeId, "contador")).status).toBe(200);
  });

  it("404 en español para un escaneo de otra tienda", async () => {
    const { image, storeId } = fresh();
    const id = await createScan(storeId, [image]);

    const response = await get(id, fresh().storeId);

    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("No encontramos ese escaneo de factura.");
  });

  it("404 para un id que no es uuid", async () => {
    expect((await get("no-es-un-uuid", fresh().storeId)).status).toBe(404);
  });

  it("403 al vendedor y 401 sin sesión", async () => {
    const { image, storeId } = fresh();
    const id = await createScan(storeId, [image]);

    expect((await get(id, storeId, "vendedor")).status).toBe(403);

    process.env.ALLOW_DEMO_AUTH = "false";
    expect((await get(id, storeId)).status).toBe(401);
  });
});
