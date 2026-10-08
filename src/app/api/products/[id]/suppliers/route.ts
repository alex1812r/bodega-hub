import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { getProductById } from "@/modules/products/services/products.mock-server";
import { getProductById as getProductByIdServer } from "@/modules/products/services/products.server";
import { parseSaveProductSuppliersInput } from "@/modules/products/services/productSuppliers";
import { assertCanAccessSupplierContacts } from "@/shared/auth/contactAccess";

export async function GET(request: Request, context: RouteContext<"/api/products/[id]/suppliers">) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    assertCanAccessSupplierContacts(auth.role);
    const { id } = await context.params;

    if (resolveDataSource() === "mock") {
      getProductById(id, auth.storeId);
    } else {
      await getProductByIdServer(id, auth.storeId);
    }

    return jsonData(
      await getSupplierProductsService().listProductSuppliers(
        id,
        new URL(request.url).searchParams,
        auth.storeId,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Guarda los proveedores del producto: el cuerpo es el estado DESEADO completo
 * de sus vínculos activos. Mismo permiso que vincular un proveedor desde
 * contactos (`POST /api/supplier-products`): `products.manage` y acceso a
 * contactos proveedor; la RPC exige además rol admin / almacén.
 */
export async function PUT(request: Request, context: RouteContext<"/api/products/[id]/suppliers">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    assertCanAccessSupplierContacts(auth.role);
    const { id } = await context.params;
    const suppliers = parseSaveProductSuppliersInput(await readJsonBody(request));

    return jsonData(
      await getSupplierProductsService().saveProductSuppliers(id, suppliers, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
