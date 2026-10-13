/**
 * @jest-environment node
 */

/**
 * DEC-02: anular y devolver una venta (y ver su efecto) exigen `sales.cancel`,
 * no `sales.create`. El administrador lo tiene SIEMPRE, con el interruptor «El
 * administrador puede vender» apagado o encendido; el vendedor, como hasta hoy;
 * contador y almacén, no. Vender sigue exigiendo `sales.create`.
 */
jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: () => "supabase",
}));
jest.mock("../../../../modules/sales/services/sales.server", () => ({
  ...jest.requireActual("../../../../modules/sales/services/sales.server"),
  cancelSale: jest.fn(async () => ({ id: "sale", status: "cancelada" })),
  createSale: jest.fn(async () => ({ sale: { id: "sale" } })),
  returnSale: jest.fn(async () => ({ sale: { id: "sale", status: "devuelta" } })),
}));
jest.mock("../../../../modules/sales/services/saleImpact.server", () => ({
  getSaleImpact: jest.fn(async () => ({ allowed: true })),
}));

import { getSaleImpact } from "@/modules/sales/services/saleImpact.server";
import { cancelSale, createSale, returnSale } from "@/modules/sales/services/sales.server";
import type { Permission } from "@/shared/auth/permissions";
import { mockUserProfiles } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST as createSaleRoute } from "../route";
import { PATCH as cancelRoute } from "./cancel/route";
import { GET as impactRoute } from "./impact/route";
import { POST as returnRoute } from "./return/route";

const SALE_ID = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id: SALE_ID }) };

/** `user-…` = ese perfil del mock (con sus excepciones); si no, el perfil demo del rol. */
function headers(roleOrUserId: string): Record<string, string> {
  return roleOrUserId.startsWith("user-")
    ? { "x-demo-user-id": roleOrUserId }
    : { "x-demo-role": roleOrUserId };
}

const actions = {
  anular: (role: string) =>
    cancelRoute(new Request(`http://localhost/api/sales/${SALE_ID}/cancel`, { headers: headers(role), method: "PATCH" }), context),
  devolver: (role: string) =>
    returnRoute(new Request(`http://localhost/api/sales/${SALE_ID}/return`, { headers: headers(role), method: "POST" }), context),
  "efecto de anular": (role: string) =>
    impactRoute(new Request(`http://localhost/api/sales/${SALE_ID}/impact?action=cancel`, { headers: headers(role) }), context),
  "efecto de devolver": (role: string) =>
    impactRoute(new Request(`http://localhost/api/sales/${SALE_ID}/impact?action=return`, { headers: headers(role) }), context),
};

const serviceOf = {
  anular: cancelSale,
  devolver: returnSale,
  "efecto de anular": getSaleImpact,
  "efecto de devolver": getSaleImpact,
} as const;

type Action = keyof typeof actions;
const ACTIONS = Object.keys(actions) as Action[];

function mockProfile(id: string) {
  const profile = mockUserProfiles.find(
    (candidate) => candidate.id === id && (candidate.storeId ?? null) === DEFAULT_STORE_ID,
  );

  if (!profile) {
    throw new Error(`El mock no tiene ${id} en la tienda por defecto`);
  }

  return profile;
}

async function withOverrides<T>(
  id: string,
  overrides: { denied?: Permission[]; granted?: Permission[] },
  run: () => Promise<T>,
) {
  const profile = mockProfile(id);
  const previous = { denied: profile.deniedPermissions, granted: profile.grantedPermissions };

  profile.deniedPermissions = overrides.denied ?? [];
  profile.grantedPermissions = overrides.granted ?? [];

  try {
    return await run();
  } finally {
    profile.deniedPermissions = previous.denied;
    profile.grantedPermissions = previous.granted;
  }
}

describe("DEC-02 · anular y devolver ventas por rol", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each(ACTIONS)("%s", (action) => {
    it("admin con «El administrador puede vender» APAGADO: 200", async () => {
      const response = await withOverrides("user-admin", {}, () => actions[action]("admin"));

      expect(response.status).toBe(200);
      expect(serviceOf[action]).toHaveBeenCalledTimes(1);
    });

    it("admin con el interruptor ENCENDIDO: 200", async () => {
      const response = await withOverrides(
        "user-admin",
        { granted: ["sales.create", "cash.operate"] },
        () => actions[action]("admin"),
      );

      expect(response.status).toBe(200);
      expect(serviceOf[action]).toHaveBeenCalledTimes(1);
    });

    it("vendedor: 200, como hasta hoy", async () => {
      const response = await actions[action]("vendedor");

      expect(response.status).toBe(200);
      expect(serviceOf[action]).toHaveBeenCalledTimes(1);
    });

    it.each(["contador", "almacen"])("%s: 403 sin llegar al servicio", async (role) => {
      const response = await actions[action](role);

      expect(response.status).toBe(403);
      expect(serviceOf[action]).not.toHaveBeenCalled();
    });

    it("vendedor con `sales.create` denegado: 403 (no gana la anulación de rebote)", async () => {
      const response = await withOverrides("user-seller", { denied: ["sales.create"] }, () =>
        actions[action]("user-seller"),
      );

      expect(response.status).toBe(403);
      expect(serviceOf[action]).not.toHaveBeenCalled();
    });

    it("vendedor con `sales.create` denegado y `sales.cancel` concedido a mano: 200", async () => {
      const response = await withOverrides(
        "user-seller",
        { denied: ["sales.create"], granted: ["sales.cancel"] },
        () => actions[action]("user-seller"),
      );

      expect(response.status).toBe(200);
    });

    it("vendedor con `sales.cancel` denegado: 403 aunque pueda vender", async () => {
      const response = await withOverrides("user-seller", { denied: ["sales.cancel"] }, () =>
        actions[action]("user-seller"),
      );

      expect(response.status).toBe(403);
      expect(serviceOf[action]).not.toHaveBeenCalled();
    });
  });

  it("el efecto que ve el admin con el interruptor apagado lleva caja y baúl", async () => {
    await withOverrides("user-admin", {}, () => actions["efecto de anular"]("admin"));

    expect(getSaleImpact).toHaveBeenCalledWith(SALE_ID, "cancel", DEFAULT_STORE_ID, {
      canViewCash: true,
      canViewVault: true,
    });
  });

  it("vender sigue exigiendo `sales.create`: el admin con el interruptor apagado recibe 403", async () => {
    const response = await withOverrides("user-admin", {}, () =>
      createSaleRoute(
        new Request("http://localhost/api/sales", {
          body: JSON.stringify({}),
          headers: { ...headers("admin"), "content-type": "application/json" },
          method: "POST",
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(createSale).not.toHaveBeenCalled();
  });
});
