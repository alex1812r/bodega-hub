import { z } from "zod";

import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
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
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().positive(),
      unitPriceRef: z.number().min(0).optional(),
    }),
  ),
  notes: z.string().optional(),
  refRateVes: z.number().positive().optional(),
  taxRef: z.number().min(0).default(0),
});

export async function GET(request: Request) {
  try {
    await requirePermission(request, "sales.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await listSalesServer(searchParams)
        : listSalesMock(searchParams);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "sales.create");
    const input = createSaleSchema.parse(await request.json());
    const data =
      resolveDataSource() === "supabase"
        ? await createSaleServer(input)
        : createSaleMock(input);

    return jsonCreated(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
