/**
 * @jest-environment node
 */
jest.mock("../../../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";
import { INVOICE_SCAN_REAL_SESSION_MESSAGE } from "@/modules/invoice-scan/server/requireScanSession";

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
  const originalDataSource = process.env.API_DATA_SOURCE;

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  const SCAN_B = "60aaaa98-5b79-4b44-82c9-44814095bd49";
  const STORE_B = "00000000-0000-4000-8000-000000000001";

  it("con datos en Supabase, anon con cabeceras demo no descarta un escaneo de otra tienda: 401 sin llamar a la RPC (caos-4 M2)", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    process.env.ALLOW_DEMO_AUTH = "true";
    (createAdminSupabaseClient as jest.Mock).mockClear();

    const response = await discard(SCAN_B, STORE_B, "admin");

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_REAL_SESSION_MESSAGE);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("con datos en Supabase y sesión real, descarta con la tienda de la sesión", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    process.env.ALLOW_DEMO_AUTH = "true";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue({
      deniedPermissions: [],
      grantedPermissions: [],
      id: "f2120000-0000-4000-8000-000000000001",
      isActive: true,
      name: "Almacén",
      role: "almacen",
      storeId: STORE_B,
    });
    const maybeSingle = jest.fn(async () => ({ data: { id: SCAN_B, status: "discarded" }, error: null }));
    const rpc = jest.fn(() => ({ select: () => ({ maybeSingle }) }));
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({ rpc });

    const response = await discard(SCAN_B, "otra-tienda-por-cabecera", "admin");

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ scanId: SCAN_B, status: "discarded" });
    expect(rpc).toHaveBeenCalledWith("discard_invoice_scan", { p_id: SCAN_B, p_store_id: STORE_B });
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
