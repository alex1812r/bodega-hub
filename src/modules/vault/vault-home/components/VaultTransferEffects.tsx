import { ArrowRight } from "lucide-react";

import { Badge } from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";
import { DATE_FORMATS, formatDate } from "@/shared/utils/date";

import {
  buildVaultBucketConfirmEffects,
  formatVaultAmount,
  formatVaultSignedAmount,
  type VaultBucketCurrency,
  type VaultClosureCurrencyEffect,
  type VaultClosuresTransferEffect,
} from "../utils/vaultEffect";

const currencyLabels: Record<VaultBucketCurrency, string> = { ref: "REF", ves: "Bs." };

type ClosureCurrencyRowProps = {
  currency: VaultBucketCurrency;
  effect: VaultClosureCurrencyEffect;
};

function ClosureCurrencyRow({ currency, effect }: ClosureCurrencyRowProps) {
  const { counted, difference, theoretical } = effect;
  const isShort = difference != null && difference < 0;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5" data-currency={currency}>
      <dt className="sr-only">{currencyLabels[currency]}</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
        <span>
          Contado{" "}
          <span className="font-medium text-foreground">{formatVaultAmount(currency, counted)}</span>
        </span>
        <span>
          Teórico{" "}
          <span className="font-medium text-foreground">
            {theoretical == null ? "no disponible" : formatVaultAmount(currency, theoretical)}
          </span>
        </span>
        {difference == null ? null : difference === 0 ? (
          <span>Sin diferencia</span>
        ) : (
          <span className={cn("font-medium", isShort ? "text-error" : "text-foreground")}>
            Diferencia {formatVaultSignedAmount(currency, difference)}{" "}
            {isShort ? "(falta)" : "(sobra)"}
          </span>
        )}
      </dd>
    </div>
  );
}

function hasAmounts(effect: VaultClosureCurrencyEffect) {
  return effect.counted !== 0 || (effect.theoretical ?? 0) !== 0;
}

type VaultTransferEffectsProps = {
  effect: VaultClosuresTransferEffect;
};

/**
 * Efecto de «Transferir cierres»: cada cierre con su contado, teórico y
 * diferencia, y el saldo de cada cubeta del baúl antes → después de sumar el
 * contado (que es lo que asienta `transfer_cash_closures_to_vault`).
 */
export function VaultTransferEffects({ effect }: VaultTransferEffectsProps) {
  const bucketEffects = buildVaultBucketConfirmEffects(effect.buckets);
  const closureCount = effect.closures.length;

  return (
    <div className="space-y-3 py-2 text-sm">
      <ul aria-label="Cierres que se transfieren" className="divide-y divide-border">
        {effect.closures.map((closure) => (
          <li className="space-y-1 py-2 text-on-surface-variant" key={closure.id}>
            <p className="break-words font-medium text-foreground">
              {closure.registerName}
              {" · "}
              {closure.closedAt
                ? `cerrado ${formatDate(closure.closedAt, DATE_FORMATS.dateTime)}`
                : "sin fecha de cierre"}
            </p>
            <dl className="space-y-0.5">
              {hasAmounts(closure.ves) ? (
                <ClosureCurrencyRow currency="ves" effect={closure.ves} />
              ) : null}
              {hasAmounts(closure.ref) ? (
                <ClosureCurrencyRow currency="ref" effect={closure.ref} />
              ) : null}
            </dl>
            {closure.isAbsorbed ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Cierre anterior al cambio de apertura: el monto incluye el fondo, que se recicló en
                el turno siguiente. Transferirlo completo infla el baúl.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="text-on-surface-variant">
        Entra al baúl el monto contado de {closureCount}{" "}
        {closureCount === 1 ? "cierre" : "cierres"}:{" "}
        <span className="font-medium tabular-nums text-foreground">
          {formatVaultAmount("ves", effect.totalVes)}
        </span>
        {" · "}
        <span className="font-medium tabular-nums text-foreground">
          {formatVaultAmount("ref", effect.totalRef)}
        </span>
      </p>

      <ul aria-label="Saldos del baúl" className="divide-y divide-border border-t border-border">
        {bucketEffects.map((bucket) => (
          <li
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            key={bucket.label}
          >
            <span className="min-w-0 break-words text-foreground">{bucket.label}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 tabular-nums">
              <span className="text-on-surface-variant">{bucket.before}</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
              <span className="sr-only">pasa a</span>
              <Badge variant={bucket.tone === "positive" ? "success" : "default"}>
                {bucket.after}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
