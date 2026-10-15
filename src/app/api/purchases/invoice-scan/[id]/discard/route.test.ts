/**
 * @jest-environment node
 */
import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";

import { POST as scan } from "../../route";
import { POST } from "./route";

const URL_BASE = "http://localhost/api/purchases/invoice-scan";

let counter = 0;

function fresh() {
  counter += 1;
  return { image: `descarte-${counter}-${Date.now()}`, storeId: `route-discard-${counter}` };
}

async function createScan(storeId: string, image: string) {
  const form = new FormData();
  form.append("page", new File([new Uint8Array(jpegHeader(1600, 1200, image))], "p1.jpg", { type: "image/jpeg" }));
  const response = await scan(
    new Request(URL_BASE, {
      body: form,
      headers: { "x-demo-role": "almacen", "x-demo-store-id": storeId },
      method: "POST",
    }),
  );

  return ((await response.json()) as { data: { scanId: string } }).data.scanId;
}

function discard(id: string, storeId: string, role = "almacen") {
  return POST(
    new Request(`${URL_BASE}/${id}/discard`, {
      headers: { "x-demo-role": role, "x-demo-store-id": storeId },
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /api/purchases/invoice-scan/[id]/discard", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("descarta un escaneo extracted (200) y el segundo intento es 409", async () => {
    const { image, storeId } = fresh();
    const id = await createScan(storeId, image);

    const first = await discard(id, storeId);

    expect(first.status).toBe(200);
    expect((await first.json()).data).toEqual({ scanId: id, status: "discarded" });

    const second = await discard(id, storeId);

    expect(second.status).toBe(409);
    expect((await second.json()).error.message).toBe(
      "Este escaneo ya estaba descartado.",
    );
  });

  it("404 si el escaneo es de otra tienda o el id no existe", async () => {
    const { image, storeId } = fresh();
    const id = await createScan(storeId, image);

    expect((await discard(id, fresh().storeId)).status).toBe(404);
    expect((await discard("no-es-un-uuid", storeId)).status).toBe(404);
  });

  it("403 sin purchases.create y 401 sin sesión", async () => {
    const { image, storeId } = fresh();
    const id = await createScan(storeId, image);

    expect((await discard(id, storeId, "vendedor")).status).toBe(403);
    expect((await discard(id, storeId, "contador")).status).toBe(403);

    process.env.ALLOW_DEMO_AUTH = "false";
    expect((await discard(id, storeId)).status).toBe(401);
  });
});
