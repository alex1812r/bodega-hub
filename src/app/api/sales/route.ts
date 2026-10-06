import { z } from "zod";

import { resolveDataSource } from "@/lib/api/dataSource";
import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { salePaymentLineSchema } from "@/modules/payments/services/paymentSchemas";
import {
  createSale as createSaleMock,
  listSales as listSalesMock,
} from "@/modules/sales/services/sales.mock-server";
import {
  createSale as createSaleServer,
  listSales as listSalesServer,
} from "@/modules/sales/services/sales.server";

const createSaleSchema = z.object({
  // Clave de idempotencia por intento de cobro: con la misma clave el servidor
  // devuelve la venta ya registrada en vez de crear otra (respuesta perdida,
  // doble envio). Unica por tienda; opcional para clientes que no la manden.
  clientRequestId: z.string().uuid().optional(),
  customerId: z.string().min(1),
  discountRef: z.number().min(0).default(0),
  exchangeRateId: z.string().uuid().optional(),
  invoiceNumber: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
        // Un precio en cero solo lo acepta `create_sale` si el producto vale cero de
        // lista; aqui no conocemos el producto, asi que la regla vive en el RPC.
        unitPriceRef: z.number().min(0).finite().optional(),
      }),
    )
    .min(1),
  notes: z.string().optional(),
  // Cobros que se registran en la misma transaccion que la venta
  // (`create_sale_with_payments`): si uno falla, no queda venta ni descuento de
  // stock. Hasta 4 lineas, igual que el modal de cobro del POS.
  payments: z.array(salePaymentLineSchema).max(4).optional(),
  // `create_sale` valida ademas que la tasa este dentro de +-5% de la tasa vigente de
  // la tienda (`exchange_rates`); esa comparacion necesita la base y vive en el RPC.
  refRateVes: z.number().positive().finite().optional(),
  taxRef: z.number().min(0).default(0),
});

/**
 * Cuerpo JSON de la peticion. Un cuerpo vacio o malformado es culpa del cliente
 * (400), no un 500. Se mira `error.name` y no `instanceof SyntaxError`: el error
 * de `request.json()` puede venir de otro realm.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "SyntaxError") {
      throw new ApiError(400, "BAD_REQUEST", "El cuerpo de la solicitud no es un JSON valido.");
    }

    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "sales.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await listSalesServer(searchParams, auth.storeId)
        : listSalesMock(searchParams, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "sales.create");
    const input = createSaleSchema.parse(await readJsonBody(request));
    const data =
      resolveDataSource() === "supabase"
        ? await createSaleServer(input, auth.storeId)
        : createSaleMock(input, auth.storeId);

    return jsonCreated(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
