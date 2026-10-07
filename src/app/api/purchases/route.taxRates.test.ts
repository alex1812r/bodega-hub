/**
 * @jest-environment node
 */
/**
 * SHR-10 · `taxRateCode` por linea en `POST /api/purchases` y al leer el detalle.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";

import { GET as GET_DETAIL } from "./[id]/route";
import { POST } from "./route";

const PRODUCT_ID = "44444444-4444-4444-4444-444444444444";
const SUPPLIER_ID = "22222222-2222-2222-2222-222222222222";

function payload(tax: Record<string, unknown>, productId = "prod-cable", supplierId = "cont-supplier") {
  return {
    discountRef: 0,
    discountVes: 0,
    items: [
      {
        costCurrency: "ref",
        entryMode: "unit",
        productId,
        quantity: 2,
        subtotalRef: 4,
        subtotalVes: 2040,
        taxRef: 0.64,
        taxVes: 326.4,
        unitCostRef: 2,
        unitCostVes: 1020,
        ...tax,
      },
    ],
    refRateVes: 510,
    subtotalRef: 4,
    subtotalVes: 2040,
    supplierId,
    taxRef: 0.64,
    taxVes: 326.4,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

async function readLines(purchaseId: string) {
  const response = await GET_DETAIL(
    new Request(`http://localhost/api/purchases/${purchaseId}`, {
      headers: { "x-demo-role": "almacen" },
    }),
    { params: Promise.resolve({ id: purchaseId }) },
  );
  const body = await response.json();

  return (body.data.items as Array<{ taxRate: number; taxRateCode?: string }>).map((item) => ({
    taxRate: item.taxRate,
    taxRateCode: item.taxRateCode,
  }));
}

describe("/api/purchases · alicuota de IVA por linea (SHR-10)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
    resetMockTaxRates();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("mock", () => {
    it.each([
      [
        "tax_rate 13 (ninguna alicuota)",
        { taxRate: 13 },
        "El porcentaje de IVA 13.00 % no corresponde a ninguna alicuota activa",
      ],
      [
        "codigo inexistente",
        { taxRateCode: "lujo" },
        'La alicuota de IVA "lujo" no existe o no esta activa en tu tienda',
      ],
      [
        "codigo y porcentaje discordantes",
        { taxRate: 16, taxRateCode: "reducida" },
        'El porcentaje de IVA enviado (16.00 %) no coincide con la alicuota "reducida" (8.00 %)',
      ],
    ])("responde 400 con %s y el mensaje de la regla", async (_case, tax, message) => {
      const response = await post(payload(tax));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual({ code: "BAD_REQUEST", message });
    });

    it("con solo taxRateCode crea la compra y el detalle devuelve el porcentaje derivado", async () => {
      const response = await post(payload({ taxRateCode: "general" }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(await readLines(body.data.id)).toEqual([{ taxRate: 16, taxRateCode: "general" }]);
    });

    it("con solo taxRate (cliente anterior) crea la compra y guarda el codigo", async () => {
      const response = await post(payload({ taxRate: 8 }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(await readLines(body.data.id)).toEqual([{ taxRate: 8, taxRateCode: "reducida" }]);
    });

    it.each([
      ["sin taxRate ni taxRateCode", {}],
      ["taxRateCode vacio", { taxRateCode: "  " }],
      ["taxRateCode no es texto", { taxRateCode: 16 }],
      ["taxRate fuera de 0..100", { taxRate: 101, taxRateCode: "general" }],
    ])("responde 400 de formato con %s", async (_case, tax) => {
      const response = await post(payload(tax));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("BAD_REQUEST");
    });
  });

  describe("supabase", () => {
    const purchaseRow = {
      created_at: "2026-05-17T16:00:00.000Z",
      discount_ref: 0,
      id: "11111111-1111-1111-1111-111111111111",
      paid_ves: 0,
      purchase_number: "C-000001",
      ref_rate_ves: 510,
      status: "recibido",
      subtotal_ref: 4,
      supplier_id: SUPPLIER_ID,
      tax_ref: 0.64,
      total_ref: 4.64,
      total_ves: 2366.4,
      user_id: "33333333-3333-3333-3333-333333333333",
    };

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("pasa taxRateCode a la RPC como tax_rate_code", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: purchaseRow, error: null });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

      const response = await post(payload({ taxRateCode: "general" }, PRODUCT_ID, SUPPLIER_ID));

      expect(response.status).toBe(201);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0]?.[0]).toBe("create_purchase");
      expect((rpc.mock.calls[0]?.[1] as { p_items: unknown[] }).p_items).toEqual([
        {
          cost_currency: "ref",
          entry_mode: "unit",
          product_id: PRODUCT_ID,
          quantity: 2,
          subtotal_ref: 4,
          subtotal_ves: 2040,
          tax_rate_code: "general",
          tax_ref: 0.64,
          tax_ves: 326.4,
          unit_cost_ref: 2,
          unit_cost_ves: 1020,
        },
      ]);
    });

    it("el PT400 de la RPC sale como 400 con error.message tal cual", async () => {
      const message = "El porcentaje de IVA 13.00 % no corresponde a ninguna alicuota activa";
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PT400", message } });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

      const response = await post(payload({ taxRate: 13 }, PRODUCT_ID, SUPPLIER_ID));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual({ code: "BAD_REQUEST", message });
    });
  });
});
