import type { CashSession } from "@/modules/cash/types";
import type { ConfirmActionEffect } from "@/shared/components/ConfirmActionModal";
import { fromCents, toCents } from "@/shared/impact/impactVerdict";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import type { StoreVault } from "../../types";

/**
 * Efecto de las operaciones manuales del baúl sobre sus tres saldos, calculado
 * con los datos que la pantalla ya tiene y en céntimos enteros.
 *
 * Refleja lo que hacen las RPC, no lo ideal:
 * - `register_vault_deposit` y `register_vault_withdrawal` solo mueven las dos
 *   cubetas de efectivo (Bs. y REF); la cuenta no cambia nunca.
 * - `register_vault_withdrawal` rechaza el retiro entero si cualquiera de los
 *   dos montos supera su saldo: ni recorta ni deja el saldo en negativo.
 * - `transfer_cash_closures_to_vault` suma el monto CONTADO de cada cierre
 *   (`closing_ves` y `closing_ref`), no el teórico, a las cubetas de efectivo.
 */

export type VaultBucketKey = "efectivoVes" | "cuentaVes" | "efectivoRef";

export type VaultBucketCurrency = "ves" | "ref";

/** Nombres de las cubetas tal como los muestra la pantalla del baúl. */
export const vaultBucketLabels: Record<VaultBucketKey, string> = {
  cuentaVes: "Cuenta Bs.",
  efectivoRef: "Saldo REF",
  efectivoVes: "Efectivo Bs.",
};

export type VaultBalances = Pick<StoreVault, "balanceEfectivoVes" | "balanceRef" | "balanceVes">;

export type VaultBucketEffect = {
  after: number;
  before: number;
  currency: VaultBucketCurrency;
  /** Positivo si entra dinero, negativo si sale, 0 si la cubeta no cambia. */
  delta: number;
  key: VaultBucketKey;
  label: string;
};

function buildBuckets(
  vault: VaultBalances,
  deltaCents: Record<VaultBucketKey, number>,
): VaultBucketEffect[] {
  const beforeCents: Record<VaultBucketKey, number> = {
    cuentaVes: toCents(vault.balanceVes),
    efectivoRef: toCents(vault.balanceRef),
    efectivoVes: toCents(vault.balanceEfectivoVes),
  };
  const currencies: Record<VaultBucketKey, VaultBucketCurrency> = {
    cuentaVes: "ves",
    efectivoRef: "ref",
    efectivoVes: "ves",
  };
  const order: VaultBucketKey[] = ["efectivoVes", "cuentaVes", "efectivoRef"];

  return order.map((key) => ({
    after: fromCents(beforeCents[key] + deltaCents[key]),
    before: fromCents(beforeCents[key]),
    currency: currencies[key],
    delta: fromCents(deltaCents[key]),
    key,
    label: vaultBucketLabels[key],
  }));
}

export type VaultCashMovementKind = "deposit" | "withdrawal";

export type VaultCashMovementEffect = {
  /** Montos que el servidor asentará (2 decimales). */
  amountRef: number;
  amountVes: number;
  buckets: VaultBucketEffect[];
  /**
   * Solo en retiros: el monto supera el saldo de esa cubeta y el servidor
   * rechazará la operación completa ("Saldo insuficiente en el baul").
   */
  insufficient: { ref: boolean; ves: boolean };
  kind: VaultCashMovementKind;
};

export function computeVaultCashMovementEffect(input: {
  amountRef: number;
  amountVes: number;
  kind: VaultCashMovementKind;
  vault: VaultBalances;
}): VaultCashMovementEffect {
  const { kind, vault } = input;
  const vesCents = toCents(input.amountVes);
  const refCents = toCents(input.amountRef);
  const sign = kind === "deposit" ? 1 : -1;
  const isWithdrawal = kind === "withdrawal";

  return {
    amountRef: fromCents(refCents),
    amountVes: fromCents(vesCents),
    buckets: buildBuckets(vault, {
      cuentaVes: 0,
      efectivoRef: sign * refCents,
      efectivoVes: sign * vesCents,
    }),
    insufficient: {
      ref: isWithdrawal && refCents > toCents(vault.balanceRef),
      ves: isWithdrawal && vesCents > toCents(vault.balanceEfectivoVes),
    },
    kind,
  };
}

export type VaultClosureCurrencyEffect = {
  /** Lo que se contó al cerrar: es lo que el servidor suma al baúl. */
  counted: number;
  /** Contado − teórico; negativo = faltante. `null` si no hay teórico. */
  difference: number | null;
  /** Teórico guardado en el cierre; `null` si el cierre no lo trae. */
  theoretical: number | null;
};

export type VaultClosureEffect = {
  closedAt: string | null;
  id: string;
  /** Cierre anterior a `20260904b`: su monto incluye el fondo de apertura reciclado. */
  isAbsorbed: boolean;
  ref: VaultClosureCurrencyEffect;
  registerName: string;
  ves: VaultClosureCurrencyEffect;
};

export type VaultClosuresTransferEffect = {
  buckets: VaultBucketEffect[];
  closures: VaultClosureEffect[];
  /** Suma del contado de los cierres: lo que entra al baúl. */
  totalRef: number;
  totalVes: number;
};

function closureCurrencyEffect(
  countedCents: number,
  theoretical: number | null | undefined,
): VaultClosureCurrencyEffect {
  if (theoretical == null) {
    return { counted: fromCents(countedCents), difference: null, theoretical: null };
  }

  const theoreticalCents = toCents(theoretical);

  return {
    counted: fromCents(countedCents),
    difference: fromCents(countedCents - theoreticalCents),
    theoretical: fromCents(theoreticalCents),
  };
}

export function computeClosuresTransferEffect(input: {
  closures: CashSession[];
  vault: VaultBalances;
}): VaultClosuresTransferEffect {
  let totalVesCents = 0;
  let totalRefCents = 0;

  const closures = input.closures.map<VaultClosureEffect>((session) => {
    const vesCents = toCents(session.closingVes ?? 0);
    const refCents = toCents(session.closingRef ?? 0);

    totalVesCents += vesCents;
    totalRefCents += refCents;

    return {
      closedAt: session.closedAt ?? null,
      id: session.id,
      isAbsorbed: Boolean(session.absorbedBySessionId),
      ref: closureCurrencyEffect(refCents, session.theoreticalClosingRef),
      registerName: session.register.name,
      ves: closureCurrencyEffect(vesCents, session.theoreticalClosingVes),
    };
  });

  return {
    buckets: buildBuckets(input.vault, {
      cuentaVes: 0,
      efectivoRef: totalRefCents,
      efectivoVes: totalVesCents,
    }),
    closures,
    totalRef: fromCents(totalRefCents),
    totalVes: fromCents(totalVesCents),
  };
}

export function formatVaultAmount(currency: VaultBucketCurrency, value: number) {
  return currency === "ves" ? formatVesBs(value) : formatRefUsd(value);
}

/** "+Bs. 250,00" / "−Bs. 250,00": el signo va fuera para que se lea igual en Bs. y en REF. */
export function formatVaultSignedAmount(currency: VaultBucketCurrency, value: number) {
  const sign = value < 0 ? "−" : "+";

  return `${sign}${formatVaultAmount(currency, Math.abs(value))}`;
}

/** Una fila por cubeta: saldo actual → resultante, o «Sin cambio» si no se mueve. */
export function buildVaultBucketConfirmEffects(buckets: VaultBucketEffect[]): ConfirmActionEffect[] {
  return buckets.map((bucket) => {
    const before = formatVaultAmount(bucket.currency, bucket.before);

    if (bucket.delta === 0) {
      return { after: "Sin cambio", before, label: bucket.label, tone: "neutral" };
    }

    return {
      after: formatVaultAmount(bucket.currency, bucket.after),
      before,
      label: `${bucket.label} (${formatVaultSignedAmount(bucket.currency, bucket.delta)})`,
      tone: bucket.delta > 0 ? "positive" : "warning",
    };
  });
}
