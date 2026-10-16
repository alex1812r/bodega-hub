import {
  listMockLearnedAliases,
  removeMockLearnedAlias,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { mockProducts } from "@/shared/mocks/erp-data";

import { aliasNotFound } from "./supplierProductAliases.server";
import { listSupplierProductsBySupplier } from "./supplierProducts.mock-server";

import type {
  RemovedSupplierProductAlias,
  SupplierProductAlias,
  SupplierProductAliasList,
} from "../types/supplierProductAliases";

/**
 * SCN-09b · Paridad de `supplierProductAliases.server.ts` sobre el almacén de alias
 * aprendidos del mock de escaneo (`confirmScan.mock-server.ts`). Mismas reglas:
 * solo la tienda del llamador, más recientes primero; alias de otro proveedor, de
 * otra tienda o inexistente → 404 al quitar.
 */

function isLinkedToSupplier(supplierId: string, productId: string, storeId: string) {
  return listSupplierProductsBySupplier(supplierId, new URLSearchParams({ productId }), storeId).total > 0;
}

export async function listSupplierProductAliases(
  supplierId: string,
  storeId: string,
): Promise<SupplierProductAliasList> {
  const items = listMockLearnedAliases(storeId, supplierId)
    .filter((alias) => alias.supplierId === supplierId)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map(
      (alias): SupplierProductAlias => ({
        aliasNorm: alias.aliasNorm,
        hits: alias.hits,
        id: alias.id,
        inSupplierProducts: isLinkedToSupplier(supplierId, alias.productId, storeId),
        lastSeenAt: alias.lastSeenAt,
        packLabel: alias.packLabel,
        productId: alias.productId,
        productName: mockProducts.find((product) => product.id === alias.productId)?.name ?? null,
        unitsPerPack: alias.unitsPerPack,
      }),
    );

  return { items };
}

export async function removeSupplierProductAlias(
  supplierId: string,
  aliasId: string,
  storeId: string,
): Promise<RemovedSupplierProductAlias> {
  const owned = listMockLearnedAliases(storeId, supplierId).some(
    (alias) => alias.id === aliasId && alias.supplierId === supplierId,
  );

  if (!owned || !removeMockLearnedAlias(storeId, aliasId)) {
    throw aliasNotFound();
  }

  return { id: aliasId };
}
