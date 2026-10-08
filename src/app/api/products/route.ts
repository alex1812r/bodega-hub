import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { createProductSchema } from "@/modules/products/services/productSchemas";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";
import { attachPreferredSuppliers } from "@/modules/products/services/productSuppliers";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";

function getProductsService() {
  return resolveDataSource() === "supabase" ? productsServer : productsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const service = getProductsService();
    const list = await service.listProducts(new URL(request.url).searchParams, auth.storeId);

    // El vendedor no ve contactos proveedor: su listado no lleva `preferredSupplier`.
    if (!canViewSupplierContacts(auth.role)) {
      return jsonData(list);
    }

    // Una sola consulta para toda la página (sin N+1).
    const preferred = await getSupplierProductsService().listPreferredSuppliersByProduct(
      list.items.map((product) => product.id),
      auth.storeId,
    );

    return jsonData({
      ...list,
      items: attachPreferredSuppliers<{ id: string }>(list.items, preferred),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const input = createProductSchema.parse(await request.json());
    const service = getProductsService();
    return jsonCreated(await service.createProduct(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
