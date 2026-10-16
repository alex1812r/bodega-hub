/**
 * @jest-environment node
 */

import {
  listMockLearnedAliases,
  registerMockLearnedAlias,
  resetMockInvoiceScans,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { DELETE } from "./route";

const SUPPLIER = "cont-supplier";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

const context = (id: string, aliasId: string) => ({ params: Promise.resolve({ aliasId, id }) });

function remove(supplierId: string, aliasId: string, headers: Record<string, string> = {}) {
  return DELETE(
    new Request(`http://localhost/api/contacts/${supplierId}/product-aliases/${aliasId}`, {
      headers,
      method: "DELETE",
    }),
    context(supplierId, aliasId),
  );
}

describe("DELETE /api/contacts/[id]/product-aliases/[aliasId]", () => {
  let aliasId: string;

  beforeEach(() => {
    resetMockInvoiceScans();
    aliasId = registerMockLearnedAlias({ aliasNorm: "cable thw 12", productId: "prod-cable", supplierId: SUPPLIER }).id;
  });

  it("quita el alias propio (200 con el id) y deja de listarse", async () => {
    const response = await remove(SUPPLIER, aliasId);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ id: aliasId });
    expect(listMockLearnedAliases(DEFAULT_STORE_ID, SUPPLIER)).toEqual([]);
  });

  it("alias de otra tienda, de otro proveedor o inexistente → 404 sin borrar", async () => {
    const statuses = [
      (await remove(SUPPLIER, aliasId, { "x-demo-store-id": OTHER_STORE_ID })).status,
      (await remove("cont-otro", aliasId)).status,
      (await remove(SUPPLIER, "no-existe")).status,
    ];

    expect(statuses).toEqual([404, 404, 404]);
    expect(listMockLearnedAliases(DEFAULT_STORE_ID, SUPPLIER)).toHaveLength(1);
  });

  it("contador y vendedor reciben 403 (sin purchases.create); almacen puede quitar", async () => {
    const forbidden = [
      (await remove(SUPPLIER, aliasId, { "x-demo-role": "contador" })).status,
      (await remove(SUPPLIER, aliasId, { "x-demo-role": "vendedor" })).status,
    ];

    expect(forbidden).toEqual([403, 403]);
    expect(listMockLearnedAliases(DEFAULT_STORE_ID, SUPPLIER)).toHaveLength(1);
    expect((await remove(SUPPLIER, aliasId, { "x-demo-role": "almacen" })).status).toBe(200);
  });
});
