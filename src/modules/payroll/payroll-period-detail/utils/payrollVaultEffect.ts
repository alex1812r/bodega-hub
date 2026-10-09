import type { PaymentMethod } from "@bodega/core";

import {
  type VaultBalances,
  type VaultBucketCurrency,
  type VaultBucketEffect,
  type VaultBucketKey,
  vaultBucketLabels,
} from "@/modules/vault/vault-home/utils/vaultEffect";
import { fromCents, toCents } from "@/shared/impact/impactVerdict";

/**
 * Efecto de pagar o anular un recibo de nómina sobre los tres saldos del baúl,
 * calculado en céntimos enteros con los saldos que la pantalla ya tiene.
 *
 * Refleja lo que hacen las RPC, no lo ideal:
 * - `pay_payroll_item` descuenta el monto de UNA cubeta según el método
 *   (efectivo Bs. → efectivo Bs.; efectivo USD → saldo REF; pago móvil y
 *   transferencia → cuenta Bs.) y rechaza el pago (`PT402`) si supera su saldo.
 * - `cancel_payroll_payment` devuelve el mismo monto a la misma cubeta; no
 *   comprueba nada más.
 */

const bucketByMethod: Partial<Record<PaymentMethod, VaultBucketKey>> = {
  efectivo_usd: "efectivoRef",
  efectivo_ves: "efectivoVes",
  pago_movil: "cuentaVes",
  transferencia: "cuentaVes",
};

const bucketCurrencies: Record<VaultBucketKey, VaultBucketCurrency> = {
  cuentaVes: "ves",
  efectivoRef: "ref",
  efectivoVes: "ves",
};

const bucketOrder: VaultBucketKey[] = ["efectivoVes", "cuentaVes", "efectivoRef"];

/** Cubeta del baúl que toca el método; `null` si la nómina no se paga por él. */
export function resolvePayrollVaultBucket(method: PaymentMethod | null): VaultBucketKey | null {
  return method ? (bucketByMethod[method] ?? null) : null;
}

export type PayrollVaultEffect = {
  /** Total que sale (pago) o vuelve (anulación), en la moneda de la cubeta. */
  amount: number;
  bucketKey: VaultBucketKey;
  buckets: VaultBucketEffect[];
  currency: VaultBucketCurrency;
  /** Solo al pagar: el total supera el saldo de la cubeta y el servidor lo rechazará. */
  insufficient: boolean;
};

export function computePayrollVaultEffect(input: {
  /** Un monto por recibo, en la moneda del método. */
  amounts: number[];
  direction: "in" | "out";
  method: PaymentMethod | null;
  vault: VaultBalances;
}): PayrollVaultEffect | null {
  const bucketKey = resolvePayrollVaultBucket(input.method);

  if (!bucketKey) {
    return null;
  }

  const totalCents = input.amounts.reduce((total, amount) => total + toCents(amount), 0);
  const beforeCents: Record<VaultBucketKey, number> = {
    cuentaVes: toCents(input.vault.balanceVes),
    efectivoRef: toCents(input.vault.balanceRef),
    efectivoVes: toCents(input.vault.balanceEfectivoVes),
  };
  const signedCents = input.direction === "out" ? -totalCents : totalCents;

  return {
    amount: fromCents(totalCents),
    bucketKey,
    buckets: bucketOrder.map((key) => {
      const deltaCents = key === bucketKey ? signedCents : 0;

      return {
        after: fromCents(beforeCents[key] + deltaCents),
        before: fromCents(beforeCents[key]),
        currency: bucketCurrencies[key],
        delta: fromCents(deltaCents),
        key,
        label: vaultBucketLabels[key],
      };
    }),
    currency: bucketCurrencies[bucketKey],
    insufficient: input.direction === "out" && totalCents > beforeCents[bucketKey],
  };
}
