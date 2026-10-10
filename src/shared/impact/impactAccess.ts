import type { Permission } from "@/shared/auth/permissions";

/**
 * Qué parte del libro de dinero puede ver quien pide un impact (AUD-01).
 *
 * El permiso de la acción (`sales.create`, `payments.manage`…) autoriza a ver el
 * VEREDICTO y cuánto se mueve; no autoriza a ver datos de otro módulo. Cada dato
 * de caja o de baúl que viaja en la respuesta exige además su permiso de lectura:
 *
 * - `canViewCash` (`cash.view`): nombre de la caja y notas de su sesión.
 * - `canViewVault` (`vault.view`): saldos del baúl. Sin él `store_vaults` ni
 *   siquiera se consulta.
 */
export type ImpactLedgerAccess = {
  canViewCash: boolean;
  canViewVault: boolean;
};

export function impactLedgerAccess(permissions: readonly Permission[]): ImpactLedgerAccess {
  return {
    canViewCash: permissions.includes("cash.view"),
    canViewVault: permissions.includes("vault.view"),
  };
}

/** Solo para tests y llamadores que ya validaron los dos permisos. */
export const FULL_IMPACT_LEDGER_ACCESS: ImpactLedgerAccess = {
  canViewCash: true,
  canViewVault: true,
};
