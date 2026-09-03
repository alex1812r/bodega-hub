import { z } from "zod";

import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import {
  createSale as createSaleMock,
  listSales as listSalesMock,
} from "@/modules/sales/services/sales.mock-server";
import {
  createSale as createSaleServer,
  listSales as listSalesServer,
} from "@/modules/sales/services/sales.server";

const createSaleSchema = z.object({
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
  // `create_sale` valida ademas que la tasa este dentro de +-5% de la tasa vigente de
  // la tienda (`exchange_rates`); esa comparacion necesita la base y vive en el RPC.
  refRateVes: z.number().positive().finite().optional(),
  taxRef: z.number().min(0).default(0),
});

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
    const input = createSaleSchema.parse(await request.json());
    const data =
      resolveDataSource() === "supabase"
        ? await createSaleServer(input, auth.storeId)
        : createSaleMock(input, auth.storeId);

    return jsonCreated(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
