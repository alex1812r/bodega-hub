"use client";

import { useVault } from "@/modules/vault/hooks/useVault";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

type PayrollVaultPanelProps = {
  /** Total pendiente de pagar de la quincena, en REF. */
  pendingRef: number;
  /** Tasa vigente, para comparar el pendiente contra los saldos en Bs. */
  rateVes: number;
};

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant py-2 last:border-b-0">
      <span className="text-sm text-on-surface-variant">{label}</span>
      <span className="tabular-nums text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

/** "Disponible en baul": los tres saldos y el aviso cuando ninguno alcanza. */
export function PayrollVaultPanel({ pendingRef, rateVes }: PayrollVaultPanelProps) {
  const vault = useVault();
  const balanceEfectivoVes = vault.data?.balanceEfectivoVes ?? 0;
  const balanceVes = vault.data?.balanceVes ?? 0;
  const balanceRef = vault.data?.balanceRef ?? 0;
  const pendingVes = rateVes > 0 ? pendingRef * rateVes : null;
  const coversRef = balanceRef >= pendingRef;
  const coversVes =
    pendingVes != null && Math.max(balanceEfectivoVes, balanceVes) >= pendingVes;
  const showWarning = pendingRef > 0 && !vault.isLoading && !coversRef && !coversVes;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disponible en baul</CardTitle>
        <CardDescription>
          Saldos con los que se paga la nomina. El pago descuenta de la cubeta del metodo elegido.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {vault.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            No pudimos cargar los saldos del baul.
          </p>
        ) : null}

        <div>
          <BalanceRow
            label="Efectivo Bs."
            value={vault.isLoading ? "—" : formatVesBs(balanceEfectivoVes)}
          />
          <BalanceRow
            label="Cuenta Bs."
            value={vault.isLoading ? "—" : formatVesBs(balanceVes)}
          />
          <BalanceRow label="REF" value={vault.isLoading ? "—" : formatRefUsd(balanceRef)} />
        </div>

        <div className="rounded-lg border border-outline-variant p-3">
          <p className="text-sm text-on-surface-variant">Pendiente por pagar</p>
          <p className="tabular-nums text-lg font-semibold text-foreground">
            {formatRefUsd(pendingRef)}
          </p>
          {pendingVes != null ? (
            <p className="text-xs text-on-surface-variant">
              {formatVesBs(pendingVes)} a la tasa vigente
            </p>
          ) : (
            <p className="text-xs text-on-surface-variant">
              Sin tasa del dia no podemos estimar el equivalente en Bs.
            </p>
          )}
        </div>

        {showWarning ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            El baul no alcanza para cubrir lo pendiente. Deposita o transfiere cierres antes de
            pagar.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
