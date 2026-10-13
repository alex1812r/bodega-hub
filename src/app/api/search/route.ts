import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import { getSearchService } from "@/modules/search/services";
import {
  globalSearchQueryLength,
  isGlobalSearchQueryTooShort,
  normalizeGlobalSearchQuery,
} from "@/modules/search/services/searchQuery";
import {
  emptyGlobalSearchResults,
  GLOBAL_SEARCH_MAX_LENGTH,
  type GlobalSearchGroup,
  globalSearchPermissions,
} from "@/modules/search/types";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";

/**
 * Búsqueda global del header. Exige sesión de tienda con al menos uno de los
 * permisos de lectura (productos, ventas, compras, contactos) y devuelve cada
 * tipo solo si el rol tiene el suyo. La tienda sale de la sesión.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, Object.values(globalSearchPermissions));
    const query = normalizeGlobalSearchQuery(new URL(request.url).searchParams.get("q"));

    if (globalSearchQueryLength(query) > GLOBAL_SEARCH_MAX_LENGTH) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `La búsqueda admite hasta ${GLOBAL_SEARCH_MAX_LENGTH} caracteres.`,
      );
    }

    if (isGlobalSearchQueryTooShort(query)) {
      return jsonData(emptyGlobalSearchResults());
    }

    const can = (group: GlobalSearchGroup) =>
      auth.permissions.includes(globalSearchPermissions[group]);

    return jsonData(
      await getSearchService().searchStore({
        query,
        scopes: {
          contacts: can("contacts"),
          customersOnly: !canViewSupplierContacts(auth.role),
          products: can("products"),
          purchases: can("purchases"),
          sales: can("sales"),
        },
        storeId: auth.storeId,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
