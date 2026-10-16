/**
 * @jest-environment node
 */

import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import {
  finalizeInvoiceScan,
  precheckInvoiceScan,
  registerMockInvoiceScan,
  resetMockInvoiceScans,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const SUPPLIER = "cont-supplier";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function extraction(...rawTexts: string[]): InvoiceExtraction {
  return {
    confidence: 0.9,
    currency: "VES",
    lines: rawTexts.map((rawText) => ({ confidence: 0.9, description: rawText, lineTotal: 1, quantity: 1, rawText, unitPrice: 1 })),
    supplier: { name: "Proveedor" },
    warnings: [],
  };
}

/** Aprende alias en el almacén mock por el mismo camino que una compra escaneada. */
async function learn(storeId: string, supplierId: string, lines: { productId: string; rawText: string }[]) {
  const scan = registerMockInvoiceScan({ extracted: extraction(...lines.map((line) => line.rawText)), storeId });
  const key = crypto.randomUUID();
  const prechecked = await precheckInvoiceScan({ clientRequestId: key, scanId: scan.id }, storeId);

  await finalizeInvoiceScan(
    prechecked,
    {
      clientRequestId: key,
      items: lines.map((line) => ({ entryMode: "pack" as const, packLabel: "Bulto", productId: line.productId, unitsPerPack: 12 })),
      lines: lines.map((line, lineIndex) => ({ lineIndex, packLabel: "Bulto", productId: line.productId, unitsPerPack: 12 })),
      purchaseId: `purchase-${crypto.randomUUID()}`,
      supplierId,
    },
    storeId,
  );
}

const listContext = (id: string) => ({ params: Promise.resolve({ id }) });

function request(path: string, init: RequestInit & { role?: string; storeId?: string } = {}) {
  const headers: Record<string, string> = {};

  if (init.role) headers["x-demo-role"] = init.role;
  if (init.storeId) headers["x-demo-store-id"] = init.storeId;

  return new Request(`http://localhost${path}`, { headers, method: init.method });
}

describe("/api/contacts/[id]/product-aliases", () => {
  beforeEach(() => {
    resetMockInvoiceScans();
  });

  it("lista los alias del proveedor con producto, empaque, hits y si está en sus productos", async () => {
    await learn(DEFAULT_STORE_ID, SUPPLIER, [
      { productId: "prod-cable", rawText: "Cable THW 12" },
      { productId: "prod-drill", rawText: "Taladro 500W" },
    ]);
    await learn(DEFAULT_STORE_ID, "cont-otro", [{ productId: "prod-cable", rawText: "Cable otro" }]);

    const response = await GET(request(`/api/contacts/${SUPPLIER}/product-aliases`), listContext(SUPPLIER));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aliasNorm: "cable thw 12",
          hits: 1,
          id: expect.any(String),
          inSupplierProducts: true,
          lastSeenAt: expect.any(String),
          packLabel: "Bulto",
          productId: "prod-cable",
          productName: expect.any(String),
          unitsPerPack: 12,
        }),
        expect.objectContaining({ aliasNorm: "taladro 500w", inSupplierProducts: false, productId: "prod-drill" }),
      ]),
    );
  });

  it("no muestra alias de otra tienda", async () => {
    await learn(OTHER_STORE_ID, SUPPLIER, [{ productId: "prod-cable", rawText: "Cable THW 12" }]);

    const response = await GET(request(`/api/contacts/${SUPPLIER}/product-aliases`), listContext(SUPPLIER));

    expect((await response.json()).data.items).toEqual([]);
  });

  it("contador puede listar; vendedor recibe 403", async () => {
    const asContador = await GET(
      request(`/api/contacts/${SUPPLIER}/product-aliases`, { role: "contador" }),
      listContext(SUPPLIER),
    );
    const asVendedor = await GET(
      request(`/api/contacts/${SUPPLIER}/product-aliases`, { role: "vendedor" }),
      listContext(SUPPLIER),
    );

    expect(asContador.status).toBe(200);
    expect(asVendedor.status).toBe(403);
  });
});
