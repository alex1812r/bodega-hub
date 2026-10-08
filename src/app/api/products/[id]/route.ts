import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { updateProductSchema } from "@/modules/products/services/productSchemas";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";
import { attachPreferredSuppliers } from "@/modules/products/services/productSuppliers";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";

function getProductsService() {
  return resolveDataSource() === "supabase" ? productsServer : productsMockServer;
}

export async function GET(request: Request, context: RouteContext<"/api/products/[id]">) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const { id } = await context.params;
    const service = getProductsService();
    const product = await service.getProductById(id, auth.storeId);

    // El vendedor no ve contactos proveedor: su detalle no lleva `preferredSupplier`.
    if (!canViewSupplierContacts(auth.role)) {
      return jsonData(product);
    }

    const preferred = await getSupplierProductsService().listPreferredSuppliersByProduct(
      [product.id],
      auth.storeId,
    );

    return jsonData(attachPreferredSuppliers([product], preferred)[0]);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/products/[id]">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const input = updateProductSchema.parse(await request.json());
    const service = getProductsService();
    return jsonData(await service.updateProduct(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/products/[id]">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const service = getProductsService();
    return jsonData(await service.deleteProduct(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
