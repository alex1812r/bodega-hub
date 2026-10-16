/**
 * @jest-environment node
 */
import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";

import { INVOICE_SCAN_REAL_SESSION_MESSAGE, requireInvoiceScanSession } from "./requireScanSession";

const STORE = "e253d92f-6e03-44e3-be6c-6be85d64e33c";
const USER = "f2120000-0000-4000-8000-000000000001";

function demoRequest() {
  return new Request("http://localhost/api/purchases/invoice-scan", {
    headers: { "x-demo-role": "admin", "x-demo-store-id": STORE },
    method: "POST",
  });
}

function session(id: string) {
  return {
    deniedPermissions: [],
    grantedPermissions: [],
    id,
    isActive: true,
    name: "Almacén",
    role: "almacen" as const,
    storeId: STORE,
  };
}

describe("requireInvoiceScanSession (caos-4 M2)", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  afterEach(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("en mock, la sesión demo sigue valiendo", async () => {
    process.env.ALLOW_DEMO_AUTH = "true";

    await expect(requireInvoiceScanSession(demoRequest(), "purchases.create", "mock")).resolves.toEqual({
      storeId: STORE,
      userId: "user-admin",
    });
  });

  it("en supabase, la sesión demo es 401 con el mensaje en español", async () => {
    process.env.ALLOW_DEMO_AUTH = "true";

    await expect(requireInvoiceScanSession(demoRequest(), "purchases.create", "supabase")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: INVOICE_SCAN_REAL_SESSION_MESSAGE,
      status: 401,
    });
  });

  it("en supabase, con sesión real devuelve su tienda y su usuario aunque haya cabeceras demo", async () => {
    process.env.ALLOW_DEMO_AUTH = "true";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(session(USER));

    await expect(requireInvoiceScanSession(demoRequest(), "purchases.create", "supabase")).resolves.toEqual({
      storeId: STORE,
      userId: USER,
    });
  });

  it("en supabase, si la sesión cae entre las dos consultas, 401", async () => {
    process.env.ALLOW_DEMO_AUTH = "true";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValueOnce(session(USER)).mockResolvedValueOnce(null);

    await expect(requireInvoiceScanSession(demoRequest(), "purchases.create", "supabase")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("sin demo, en supabase basta la sesión real (una sola consulta)", async () => {
    process.env.ALLOW_DEMO_AUTH = "false";
    (getAuthProfileFromSession as jest.Mock).mockClear().mockResolvedValue(session(USER));

    await expect(requireInvoiceScanSession(demoRequest(), "purchases.create", "supabase")).resolves.toEqual({
      storeId: STORE,
      userId: USER,
    });
    expect(getAuthProfileFromSession).toHaveBeenCalledTimes(1);
  });
});
