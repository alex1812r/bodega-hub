/**
 * @jest-environment node
 */
/**
 * POS-05 · P4-2: un vendedor por API vendía con `discountRef = subtotal − 0,01`
 * (el RPC solo rechaza descuento ≥ subtotal). El BFF valida el descuento antes de
 * tocar la base, igual con datos reales que con el mock.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

jest.mock("../../../modules/sales/services/sales.mock-server", () => {
  const actual = jest.requireActual("../../../modules/sales/services/sales.mock-server");

  return { ...actual, createSale: jest.fn(actual.createSale) };
});

import { adminSellPermissions } from "@bodega/core";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createSale as createSaleMock } from "@/modules/sales/services/sales.mock-server";
import { mockUserProfiles } from "@/shared/mocks/erp-data";
import {
  SALE_DISCOUNT_DECIMALS_MESSAGE,
  SALE_DISCOUNT_FORBIDDEN_MESSAGE,
  SALE_DISCOUNT_NEEDS_PRICES_MESSAGE,
  SALE_DISCOUNT_NEGATIVE_MESSAGE,
  SALE_DISCOUNT_OVER_SUBTOTAL_MESSAGE,
} from "@/modules/sales/utils/saleDiscountPolicy";

import { POST } from "./route";

type DataSource = "mock" | "supabase";
type Role = "admin" | "vendedor";

const SUBTOTAL_REF = 15;
const SUPABASE_IDS = {
  customerId: "11111111-1111-4111-8111-111111111111",
  productId: "44444444-4444-4444-8444-444444444444",
};
const MOCK_IDS = { customerId: "cont-customer", productId: "prod-drill" };

let requestSequence = 0;

/** Interruptor «El administrador puede vender» (POS-02): sin él, el admin no llega al descuento. */
function setAdminCanSell(enabled: boolean) {
  const admin = mockUserProfiles.find((profile) => profile.id === "user-admin");

  if (!admin) {
    throw new Error("Falta el perfil mock user-admin");
  }

  admin.grantedPermissions = enabled ? [...adminSellPermissions] : undefined;
}

function nextClientRequestId() {
  requestSequence += 1;

  return `6f1a2b3c-4d5e-4f60-8a71-${String(requestSequence).padStart(12, "0")}`;
}

/**
 * `discountJson` va tal cual al cuerpo: permite `1e999`, `"5"` o `null`. Una línea
 * de 15,00; el precio solo viaja si el descuento es positivo (el BFF lo exige, POS-F4),
 * como en el POS, que no envía ni precio ni descuento.
 */
function postSale(dataSource: DataSource, role: Role, discountJson: string | undefined) {
  const price = Number(discountJson) > 0 ? `,"unitPriceRef":${SUBTOTAL_REF}` : "";
  const ids = dataSource === "supabase" ? SUPABASE_IDS : MOCK_IDS;
  const fields = [
    `"clientRequestId":"${nextClientRequestId()}"`,
    `"customerId":"${ids.customerId}"`,
    `"items":[{"productId":"${ids.productId}","quantity":1${price}}]`,
    `"refRateVes":510`,
  ];

  if (discountJson !== undefined) {
    fields.push(`"discountRef":${discountJson}`);
  }

  return POST(
    new Request("http://localhost/api/sales", {
      body: `{${fields.join(",")}}`,
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
  );
}

function mountSalesRpc(error: { code: string; message: string } | null = null) {
  const rpc = jest.fn(async (_name: string, args?: Record<string, unknown>) => {
    if (error) {
      return { data: null, error };
    }

    const discountRef = Number(args?.p_discount_ref ?? 0);

    return {
      data: {
        created_at: "2026-10-06T07:17:37.000Z",
        customer_id: SUPABASE_IDS.customerId,
        discount_ref: discountRef,
        exchange_rate_id: null,
        id: "22222222-2222-4222-8222-000000000001",
        invoice_number: "V-20261006071737961",
        notes: null,
        paid_ves: 0,
        ref_rate_ves: 510,
        status: "pendiente_pago",
        subtotal_ref: SUBTOTAL_REF,
        tax_ref: 0,
        total_ref: SUBTOTAL_REF - discountRef,
        total_ves: (SUBTOTAL_REF - discountRef) * 510,
        updated_at: "2026-10-06T07:17:37.000Z",
        user_id: "33333333-3333-4333-8333-333333333333",
      },
      error: null,
    };
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

  return rpc;
}

describe.each<DataSource>(["supabase", "mock"])("POST /api/sales · descuento (%s)", (dataSource) => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  let rpc: ReturnType<typeof mountSalesRpc>;

  /** Veces que la petición llegó a crear la venta (RPC real o servicio mock). */
  function creations() {
    return dataSource === "supabase" ? rpc.mock.calls.length : (createSaleMock as jest.Mock).mock.calls.length;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_DATA_SOURCE = dataSource;
    setAdminCanSell(true);
    rpc = mountSalesRpc();
  });

  afterEach(() => {
    setAdminCanSell(false);
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each<[string, Role, string | undefined]>([
    ["vendedor sin descuento", "vendedor", undefined],
    ["vendedor con descuento 0 (su tope)", "vendedor", "0"],
    ["admin sin descuento", "admin", "0"],
    ["admin con descuento", "admin", "5"],
    ["admin con descuento de 2 decimales", "admin", "1.25"],
    // El tope del admin no cambia: sigue siendo el del RPC (POS-05 no lo toca).
    ["admin con subtotal − 0,01", "admin", String(SUBTOTAL_REF - 0.01)],
  ])("acepta: %s", async (_caso, role, discountJson) => {
    const response = await postSale(dataSource, role, discountJson);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.discountRef).toBe(Number(discountJson ?? 0));
    expect(creations()).toBe(1);
  });

  it.each<[string, string]>([
    ["tope + 0,01", "0.01"],
    ["un descuento cualquiera", "5"],
    ["subtotal − 0,01 (P4-2)", String(SUBTOTAL_REF - 0.01)],
    ["subtotal", String(SUBTOTAL_REF)],
  ])("el vendedor no aplica descuentos: %s → 403 sin crear la venta", async (_caso, discountJson) => {
    const response = await postSale(dataSource, "vendedor", discountJson);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toEqual({ code: "FORBIDDEN", message: SALE_DISCOUNT_FORBIDDEN_MESSAGE });
    expect(creations()).toBe(0);
  });

  describe.each<Role>(["vendedor", "admin"])("forma inválida como %s", (role) => {
    it.each<[string, string, string]>([
      ["negativo", "-0.01", SALE_DISCOUNT_NEGATIVE_MESSAGE],
      ["negativo entero", "-5", SALE_DISCOUNT_NEGATIVE_MESSAGE],
      ["más de 2 decimales", "1.005", SALE_DISCOUNT_DECIMALS_MESSAGE],
    ])("%s → 400 con mensaje y sin crear la venta", async (_caso, discountJson, message) => {
      const response = await postSale(dataSource, role, discountJson);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message });
      expect(creations()).toBe(0);
    });

    it.each<[string, string]>([
      ["Infinity vía 1e999", "1e999"],
      ["-Infinity vía -1e999", "-1e999"],
      ["string", '"5"'],
      ["string no numérico", '"NaN"'],
      ["null", "null"],
      ["objeto", "{}"],
    ])("%s → 400 sin crear la venta", async (_caso, discountJson) => {
      const response = await postSale(dataSource, role, discountJson);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(JSON.stringify(body.error.issues)).toContain("discountRef");
      expect(creations()).toBe(0);
    });

    it("NaN literal (JSON inválido) → 400 sin crear la venta", async () => {
      const response = await postSale(dataSource, role, "NaN");

      expect(response.status).toBe(400);
      expect(creations()).toBe(0);
    });
  });
});

describe("POST /api/sales · el rechazo del RPC llega tal cual", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_DATA_SOURCE = "supabase";
    setAdminCanSell(true);
  });

  afterEach(() => {
    setAdminCanSell(false);
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("un PT400 de descuento del RPC responde 400 con su mensaje", async () => {
    const message = "El descuento (5.00 REF) debe ser menor que el subtotal de la venta (4.00 REF)";
    const rpc = mountSalesRpc({ code: "PT400", message });

    const response = await postSale("supabase", "admin", "5");
    const body = await response.json();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    expect(body.error.message).toBe(message);
  });
});

/**
 * POS-F3 (caos pos-nav F5): el RPC solo aplica «descuento < subtotal» al vendedor, y
 * un admin con «El administrador puede vender» dejaba ventas en 0,00 con
 * `discount_ref > subtotal_ref`. Cuando todas las líneas traen `unitPriceRef` el
 * subtotal sale del cuerpo y el BFF lo rechaza sin leer nada.
 */
describe.each<DataSource>(["supabase", "mock"])(
  "POST /api/sales · descuento contra el subtotal del cuerpo (%s)",
  (dataSource) => {
    const originalDataSource = process.env.API_DATA_SOURCE;
    let rpc: ReturnType<typeof mountSalesRpc>;

    function creations() {
      return dataSource === "supabase" ? rpc.mock.calls.length : (createSaleMock as jest.Mock).mock.calls.length;
    }

    /** Dos líneas con precio: 2 × 6,20 + 1 × 5,00 = 17,40. */
    function postPricedSale(discountRef: number, priced: "all" | "first" | "none" = "all") {
      const ids = dataSource === "supabase" ? SUPABASE_IDS : MOCK_IDS;
      const price = (unitPriceRef: number, line: number) =>
        priced === "all" || (priced === "first" && line === 0) ? { unitPriceRef } : {};

      return POST(
        new Request("http://localhost/api/sales", {
          body: JSON.stringify({
            clientRequestId: nextClientRequestId(),
            customerId: ids.customerId,
            discountRef,
            items: [
              { productId: ids.productId, quantity: 2, ...price(6.2, 0) },
              { productId: ids.productId, quantity: 1, ...price(5, 1) },
            ],
            refRateVes: 510,
          }),
          headers: { "content-type": "application/json", "x-demo-role": "admin" },
          method: "POST",
        }),
      );
    }

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.API_DATA_SOURCE = dataSource;
      setAdminCanSell(true);
      rpc = mountSalesRpc();
    });

    afterEach(() => {
      setAdminCanSell(false);
      process.env.API_DATA_SOURCE = originalDataSource;
    });

    it.each([
      ["igual al subtotal", 17.4],
      ["mayor que el subtotal", 27.4],
    ])("admin con descuento %s → 400 sin crear la venta", async (_caso, discountRef) => {
      const response = await postPricedSale(discountRef);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message: SALE_DISCOUNT_OVER_SUBTOTAL_MESSAGE });
      expect(creations()).toBe(0);
    });

    it("admin con subtotal − 0,01 sigue permitido (heredado)", async () => {
      const response = await postPricedSale(17.39);

      expect(response.status).toBe(201);
      expect(creations()).toBe(1);
    });

    // POS-F4 (caos pasada 2, F5): sin precio el subtotal lo pone el RPC y el tope no se aplicaba.
    it.each([
      ["mayor que el subtotal de lista", 27.4],
      ["igual al subtotal de lista", 17.4],
      ["mínimo", 0.01],
    ])("descuento %s sin precios en el cuerpo → 400 sin crear la venta", async (_caso, discountRef) => {
      const response = await postPricedSale(discountRef, "none");
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message: SALE_DISCOUNT_NEEDS_PRICES_MESSAGE });
      expect(creations()).toBe(0);
    });

    it.each([27.75, 17.75, 0.01])(
      "descuento %s con UNA sola línea sin precio → 400 sin crear la venta",
      async (discountRef) => {
        const response = await postPricedSale(discountRef, "first");
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toEqual({ code: "BAD_REQUEST", message: SALE_DISCOUNT_NEEDS_PRICES_MESSAGE });
        expect(creations()).toBe(0);
      },
    );

    it.each<"first" | "none">(["first", "none"])(
      "sin descuento no exige precios (líneas con precio: %s): la venta se crea como hoy",
      async (priced) => {
        const response = await postPricedSale(0, priced);

        expect(response.status).toBe(201);
        expect(creations()).toBe(1);
      },
    );
  },
);
