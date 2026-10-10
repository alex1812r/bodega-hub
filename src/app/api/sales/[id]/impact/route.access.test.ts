/**
 * @jest-environment node
 */

/**
 * AUD-01: la ruta pasa al cargador real lo que la sesión puede ver de caja y de
 * baúl. El vendedor llega con `sales.create` pero sin `vault.view`.
 */
jest.mock("../../../../../lib/api/dataSource", () => ({
  resolveDataSource: () => "supabase",
}));
jest.mock("../../../../../modules/sales/services/saleImpact.server", () => ({
  getSaleImpact: jest.fn(async () => ({ allowed: true })),
}));

import { getSaleImpact } from "@/modules/sales/services/saleImpact.server";
import { mockUserProfiles } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const SALE_ID = "22222222-2222-4222-8222-222222222222";

function get(headers: Record<string, string>) {
  return GET(new Request(`http://localhost/api/sales/${SALE_ID}/impact?action=return`, { headers }), {
    params: Promise.resolve({ id: SALE_ID }),
  });
}

describe("/api/sales/[id]/impact · acceso al libro por rol", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("vendedor: pide el impact sin acceso al baúl", async () => {
    const response = await get({ "x-demo-role": "vendedor" });

    expect(response.status).toBe(200);
    expect(getSaleImpact).toHaveBeenCalledWith(SALE_ID, "return", DEFAULT_STORE_ID, {
      canViewCash: true,
      canViewVault: false,
    });
  });

  it("admin con «El administrador puede vender»: con acceso a caja y baúl", async () => {
    const admin = mockUserProfiles.find(
      (profile) => profile.id === "user-admin" && (profile.storeId ?? null) === DEFAULT_STORE_ID,
    );

    if (!admin) {
      throw new Error("El mock no tiene user-admin en la tienda por defecto");
    }

    const previous = admin.grantedPermissions;
    admin.grantedPermissions = ["sales.create", "cash.operate"];

    try {
      const response = await get({ "x-demo-role": "admin" });

      expect(response.status).toBe(200);
      expect(getSaleImpact).toHaveBeenCalledWith(SALE_ID, "return", DEFAULT_STORE_ID, {
        canViewCash: true,
        canViewVault: true,
      });
    } finally {
      admin.grantedPermissions = previous;
    }
  });

  it.each(["almacen", "contador"])("%s: 403 sin llegar al cargador", async (role) => {
    const response = await get({ "x-demo-role": role });

    expect(response.status).toBe(403);
    expect(getSaleImpact).not.toHaveBeenCalled();
  });
});
