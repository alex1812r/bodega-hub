/**
 * @jest-environment node
 */
/**
 * STK-413 · regresión de C5(b): cobro en dos pasos (`createSaleThenPayments`), el
 * camino que se activa cuando la base no tiene `create_sale_with_payments`
 * (patch 20260909 sin aplicar).
 *
 * Nacieron como `it.failing` (STK-413) y pasaron a `it` con el arreglo de STK-507.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createSale } from "./sales.server";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
type SaleRowFixture = ReturnType<typeof saleRow>;

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const CUSTOMER_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "44444444-4444-4444-4444-444444444444";

const MISSING_ATOMIC_RPC: RpcResult = {
  data: null,
  error: {
    code: "PGRST202",
    message:
      "Could not find the function public.create_sale_with_payments(p_client_request_id, ...) in the schema cache",
  },
};

function saleRow(sequence: number) {
  return {
    created_at: "2026-08-29T14:30:00.000Z",
    customer_id: CUSTOMER_ID,
    discount_ref: 0,
    exchange_rate_id: null,
    id: `22222222-2222-4222-8222-00000000000${sequence}`,
    invoice_number: `V-00000${sequence}`,
    notes: null,
    paid_ves: 0,
    ref_rate_ves: 510,
    status: "pendiente_pago" as const,
    subtotal_ref: 15,
    tax_ref: 0,
    total_ref: 15,
    total_ves: 7650,
    updated_at: "2026-08-29T14:30:00.000Z",
    user_id: "33333333-3333-3333-3333-333333333333",
  };
}

/**
 * Base SIN `create_sale_with_payments`: el RPC atómico responde "no existe" y el
 * resto se resuelve por nombre (no por orden) para no atar el test a la secuencia
 * exacta de llamadas del arreglo.
 */
function mountDatabaseWithoutAtomicRpc(handlers: {
  cancelSale?: () => RpcResult;
  registerPayment?: (callNumber: number) => RpcResult | undefined;
}) {
  const createdSales: SaleRowFixture[] = [];
  // Doble honesto (STK-507): una clave solo "existe" en la base si `create_sale`
  // la recibió y la guardó; una búsqueda por clave que nadie guarda no encuentra nada.
  const salesByStoredKey = new Map<unknown, SaleRowFixture>();
  let paymentCalls = 0;

  const rpc = jest.fn(async (name: string, args?: Record<string, unknown>): Promise<RpcResult> => {
    switch (name) {
      case "create_sale_with_payments":
        return MISSING_ATOMIC_RPC;
      case "create_sale": {
        const sale = saleRow(createdSales.length + 1);
        createdSales.push(sale);
        if (args?.p_client_request_id) {
          salesByStoredKey.set(args.p_client_request_id, sale);
        }
        return { data: sale, error: null };
      }
      case "register_payment":
        paymentCalls += 1;
        return (
          handlers.registerPayment?.(paymentCalls) ?? {
            data: { id: `pay-${paymentCalls}`, sale_id: args?.p_sale_id },
            error: null,
          }
        );
      case "cancel_sale":
        return handlers.cancelSale?.() ?? { data: { ...createdSales[0], status: "cancelada" }, error: null };
      default:
        return { data: null, error: { code: "PGRST202", message: `rpc inesperada en el test: ${name}` } };
    }
  });

  // Lecturas de `sales`: por id (refresco tras cobrar) o por `client_request_id`
  // (solo devuelve la venta que se creó guardando esa misma clave).
  const from = jest.fn(() => {
    const filters: Record<string, unknown> = {};
    const lookup = () => {
      const byKey = filters.client_request_id !== undefined;
      const found = byKey
        ? salesByStoredKey.get(filters.client_request_id)
        : (createdSales.find((sale) => sale.id === filters.id) ?? createdSales[0]);
      return found ? { ...found, status: "pagada" as const } : null;
    };
    const chain = {
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      limit: () => chain,
      maybeSingle: async () => ({ data: lookup(), error: null }),
      order: () => chain,
      select: () => chain,
      single: async () => ({ data: lookup(), error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
        const found = lookup();
        resolve({ data: found ? [found] : [], error: null });
      },
    };

    return chain;
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  const callsTo = (name: string) => rpc.mock.calls.filter((call) => call[0] === name).length;

  return { callsTo, createdSales, rpc };
}

function describeRejection(error: unknown) {
  const shape = error as { code?: unknown; details?: unknown; message?: unknown; status?: unknown };

  return {
    code: shape?.code,
    details: shape?.details,
    message: shape?.message,
    status: shape?.status,
  };
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return describeRejection(error);
  }

  return null;
}

describe("C5 · cobro en dos pasos cuando falta create_sale_with_payments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { store_id: DEFAULT_STORE_ID },
              error: null,
            }),
          })),
        })),
      })),
    });
  });

  const twoPaymentSale = () =>
    createSale(
      {
        clientRequestId: CLIENT_REQUEST_ID,
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        payments: [
          { amount: 5, currency: "USD", method: "efectivo_usd" },
          { amount: 999, currency: "USD", method: "efectivo_usd" },
        ],
        refRateVes: 510,
      },
      DEFAULT_STORE_ID,
    );

  const secondPaymentFails = (callNumber: number): RpcResult | undefined =>
    callNumber === 2
      ? { data: null, error: { code: "PT400", message: "El pago excede el saldo pendiente de la venta" } }
      : undefined;

  // Causa: en el `catch` del fallback se hace `await supabase.rpc("cancel_sale")` sin
  // mirar su `error`; si la anulación falla (ya entró un cobro) se relanza el error
  // del pago y la venta queda `pendiente_pago` con stock descontado: el cajero ve
  // "pago excede" y reintenta → otra venta. Síntoma de producción del 29-ago.
  // Evento: qa/STK-408/verdict.md §H8 (fallback en dos pasos); `w4-os` `os.20260830.symptom`.
  // Código: src/modules/sales/services/sales.server.ts:461-470 (catch de createSaleThenPayments).
  it(
    "si la anulación de la venta falla, el error dice que la venta quedó viva (no se traga el fallo de cancel_sale)",
    async () => {
      mountDatabaseWithoutAtomicRpc({ registerPayment: secondPaymentFails });
      const errorWhenCompensated = await rejectionOf(twoPaymentSale());

      const uncompensated = mountDatabaseWithoutAtomicRpc({
        cancelSale: () => ({
          data: null,
          error: { code: "PT400", message: "No se puede cancelar una venta con pagos activos" },
        }),
        registerPayment: secondPaymentFails,
      });
      const errorWhenUncompensated = await rejectionOf(twoPaymentSale());

      // Montaje: en ambos escenarios el cobro falla y se rechaza la promesa.
      expect(errorWhenCompensated).not.toBeNull();
      expect(errorWhenUncompensated).not.toBeNull();
      // Sano si (a) el servicio ya no crea la venta por este camino, o (b) el error
      // con la venta viva se distingue del error con la venta ya anulada.
      const saleLeftAlive = uncompensated.createdSales.length > 0;
      const sameErrorAsCompensated =
        JSON.stringify(errorWhenUncompensated) === JSON.stringify(errorWhenCompensated);

      expect({ ventaVivaSinAviso: saleLeftAlive && sameErrorAsCompensated }).toEqual({
        ventaVivaSinAviso: false,
      });
      // El aviso nombra la venta que quedó viva (número e id) para que no se repita.
      const aliveSale = uncompensated.createdSales[0];
      expect(errorWhenUncompensated).toMatchObject({
        code: "CONFLICT",
        details: { invoiceNumber: aliveSale.invoice_number, saleId: aliveSale.id, saleLeftAlive: true },
        status: 409,
      });
      expect(String(errorWhenUncompensated?.message)).toContain(aliveSale.invoice_number);
      expect(String(errorWhenUncompensated?.message)).toContain(aliveSale.id);
      // Con la venta ya anulada se conserva el error del cobro tal cual.
      expect(errorWhenCompensated).toMatchObject({ code: "BAD_REQUEST", status: 400 });
    },
  );

  // Causa: el fallback llama a `create_sale` "sin clave de idempotencia en este
  // camino" (comentario del código): la clave que manda el POS se descarta, así que
  // el reintento tras una respuesta perdida crea otra venta y descuenta stock otra vez.
  // Evento: qa/STK-408/verdict.md §5–6; causes.md C5(b) (4 ventas idénticas el 29-ago).
  // Código: src/modules/sales/services/sales.server.ts:411-416 y :447-448.
  it(
    "un reintento con la misma clave por el camino en dos pasos no crea otra venta",
    async () => {
      const database = mountDatabaseWithoutAtomicRpc({});
      const attempt = () =>
        createSale(
          {
            clientRequestId: CLIENT_REQUEST_ID,
            customerId: CUSTOMER_ID,
            items: [{ productId: PRODUCT_ID, quantity: 1 }],
            payments: [{ amount: 15, currency: "USD", method: "efectivo_usd" }],
            refRateVes: 510,
          },
          DEFAULT_STORE_ID,
        );

      // Primer intento: el servidor registra todo pero la respuesta se pierde.
      // Segundo intento: mismo carrito, misma clave. (Un arreglo que rechace el
      // camino en dos pasos lanzará en ambos: también es sano, no crea ventas.)
      await attempt().catch(() => undefined);
      await attempt().catch(() => undefined);

      expect(database.callsTo("create_sale_with_payments")).toBeGreaterThanOrEqual(1);
      expect(database.callsTo("create_sale")).toBeLessThanOrEqual(1);
      // Y la única venta se creó guardando la clave (si no, el reintento no la vería).
      expect(database.rpc.mock.calls.find((call) => call[0] === "create_sale")?.[1]).toMatchObject({
        p_client_request_id: CLIENT_REQUEST_ID,
      });
    },
  );
});
