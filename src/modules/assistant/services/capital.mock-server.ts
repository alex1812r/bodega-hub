import { matchesStoreIds } from "@/modules/reports/services/storeScope";
import { getCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.mock-server";
import { getVault } from "@/modules/vault/services/vault.mock-server";
import {
  mockProducts,
  mockPurchases,
  mockSales,
} from "@/shared/mocks/erp-data";

import {
  composeStoreCapital,
  PAYABLE_PURCHASE_STATUSES,
  RECEIVABLE_SALE_STATUSES,
  type StoreCapitalSummary,
} from "./capital";

const receivable = new Set<string>(RECEIVABLE_SALE_STATUSES);
const payable = new Set<string>(PAYABLE_PURCHASE_STATUSES);

function capitalForStore(storeId: string): StoreCapitalSummary {
  const storeIds = [storeId];
  const vault = getVault(storeId);
  const rateVes = getCurrentExchangeRate(storeId)?.rateVes ?? 0;

  const inventarioCostoRef = mockProducts
    .filter((product) => product.isActive && matchesStoreIds(product.storeId, storeIds))
    .reduce((total, product) => total + product.currentStock * product.currentCostRef, 0);

  const cuentasPorCobrarRef = mockSales
    .filter((sale) => receivable.has(sale.status) && matchesStoreIds(sale.storeId, storeIds))
    .reduce(
      (total, sale) =>
        total + Math.max(0, sale.totalRef - (sale.refRateVes > 0 ? sale.paidVes / sale.refRateVes : 0)),
      0,
    );

  const cuentasPorPagarRef = mockPurchases
    .filter(
      (purchase) => payable.has(purchase.status) && matchesStoreIds(purchase.storeId, storeIds),
    )
    .reduce(
      (total, purchase) =>
        total +
        Math.max(
          0,
          purchase.totalRef -
            (purchase.paidRef ??
              (purchase.refRateVes > 0 ? purchase.paidVes / purchase.refRateVes : 0)),
        ),
      0,
    );

  return composeStoreCapital({
    components: {
      cuentasPorCobrarRef,
      cuentasPorPagarRef,
      inventarioCostoRef,
      vaultCuentaVes: vault.balanceVes,
      vaultEfectivoVes: vault.balanceEfectivoVes,
      vaultRef: vault.balanceRef,
    },
    rateVes,
    storeId,
  });
}

export function getStoreCapitalSummary(storeIds: string[]): StoreCapitalSummary[] {
  return storeIds.map((storeId) => capitalForStore(storeId));
}
