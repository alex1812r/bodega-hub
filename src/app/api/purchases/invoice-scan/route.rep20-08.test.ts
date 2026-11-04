/**
 * @jest-environment node
 */

/**
 * REP20-08 (M-q2007-1, D80): escanear exige poder cargar la factura en la compra, es decir, la
 * condición de `GET /api/suppliers/[id]/products` (`products.view` efectivo + acceso a contactos
 * de tipo proveedor). Quien crea compras por concesión sin cumplirla recibe 403 antes de reservar
 * cuota y de llamar al modelo, en el escaneo, la subida firmada, los duplicados y los costos.
 */
jest.mock("../../../../modules/invoice-scan/server/provider", () => ({
  createInvoiceScanModel: jest.fn(),
}));
jest.mock("../../../../modules/invoice-scan/server/scans.mock-server", () => {
  const actual = jest.requireActual("../../../../modules/invoice-scan/server/scans.mock-server");
  return { ...actual, reserveScan: jest.fn(actual.reserveScan) };
});

import type { MockLanguageModelV4 } from "ai/test";

import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";
import { createMockInvoiceScanModel } from "@/modules/invoice-scan/server/mockModel";
import { createInvoiceScanModel } from "@/modules/invoice-scan/server/provider";
import { reserveScan } from "@/modules/invoice-scan/server/scans.mock-server";
import { INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE } from "@/modules/invoice-scan/scanAccess";
import type { Permission, UserRole } from "@/shared/auth/permissions";

import { POST as postDuplicates } from "./duplicates/route";
import { GET as getLastUnitCosts } from "./last-unit-costs/route";
import { POST as postScan } from "./route";
import { GET as getUploadUrl } from "./upload-url/route";

const BASE = "http://localhost/api/purchases/invoice-scan";

let model: MockLanguageModelV4;
let counter = 0;

function profile(role: UserRole, storeId: string, grantedPermissions: Permission[]) {
  return {
    deniedPermissions: [],
    grantedPermissions,
    id: `user-${role}-rep20-08-${counter}`,
    isActive: true,
    name: role,
    role,
    storeId,
  };
}

function scanRequest(storeId: string) {
  counter += 1;
  const form = new FormData();
  form.append(
    "page",
    new File([new Uint8Array(jpegHeader(1600, 1200, `rep20-08-${counter}-${Date.now()}`))], "p1.jpg", {
      type: "image/jpeg",
    }),
  );
  return new Request(BASE, { body: form, headers: { "x-demo-store-id": storeId }, method: "POST" });
}

const DENIED: Array<[string, UserRole, Permission[]]> = [
  ["vendedor con purchases.create (tiene products.view, no ve proveedores)", "vendedor", ["purchases.create"]],
  ["contador con purchases.create (sin products.view)", "contador", ["purchases.create"]],
];

describe("REP20-08 · escanear exige poder cargar en la compra (D80)", () => {
  beforeEach(() => {
    model = createMockInvoiceScanModel();
    (createInvoiceScanModel as jest.Mock).mockReturnValue({ model, modelId: "invoice-scan-mock", provider: "mock" });
    (reserveScan as jest.Mock).mockClear();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    (getAuthProfileFromSession as jest.Mock).mockReset();
    jest.restoreAllMocks();
  });

  it.each(DENIED)("POST escaneo: %s → 403 sin reservar cuota ni llamar al modelo", async (_name, role, granted) => {
    const storeId = `rep20-08-scan-${role}`;
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(profile(role, storeId, granted));

    const response = await postScan(scanRequest(storeId));

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE);
    expect(reserveScan).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("POST escaneo: el contador con purchases.create y products.view escanea (cobra 1)", async () => {
    const storeId = "rep20-08-scan-contador-ok";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(
      profile("contador", storeId, ["purchases.create", "products.view"]),
    );

    const response = await postScan(scanRequest(storeId));

    expect(response.status).toBe(200);
    expect((await response.json()).data.limits).toMatchObject({ used: 1 });
    expect(reserveScan).toHaveBeenCalledTimes(1);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it.each(DENIED)("upload-url: %s → 403 sin firmar subidas", async (_name, role, granted) => {
    const storeId = `rep20-08-upload-${role}`;
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(profile(role, storeId, granted));

    const response = await getUploadUrl(
      new Request(`${BASE}/upload-url?pages=1&sha256=${"b".repeat(64)}&types=image/jpeg`),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE);
  });

  it.each(DENIED)("duplicados: %s → 403", async (_name, role, granted) => {
    const storeId = `rep20-08-dup-${role}`;
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(profile(role, storeId, granted));

    const response = await postDuplicates(
      new Request(`${BASE}/duplicates`, {
        body: JSON.stringify({ number: "A-1", supplierId: "sup-1" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE);
  });

  it.each(DENIED)("últimos costos: %s → 403", async (_name, role, granted) => {
    const storeId = `rep20-08-cost-${role}`;
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(profile(role, storeId, granted));

    const response = await getLastUnitCosts(new Request(`${BASE}/last-unit-costs?productIds=p-1`));

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_LOAD_FORBIDDEN_MESSAGE);
  });

  it("upload-url, duplicados y costos siguen abiertos para almacén", async () => {
    const storeId = "rep20-08-almacen";
    (getAuthProfileFromSession as jest.Mock).mockResolvedValue(profile("almacen", storeId, []));

    expect(
      (await getUploadUrl(new Request(`${BASE}/upload-url?pages=1&sha256=${"c".repeat(64)}&types=image/jpeg`))).status,
    ).toBe(200);
    expect(
      (
        await postDuplicates(
          new Request(`${BASE}/duplicates`, {
            body: JSON.stringify({ number: "A-1", supplierId: "sup-1" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        )
      ).status,
    ).toBe(200);
    expect((await getLastUnitCosts(new Request(`${BASE}/last-unit-costs?productIds=p-1`))).status).toBe(200);
  });
});
