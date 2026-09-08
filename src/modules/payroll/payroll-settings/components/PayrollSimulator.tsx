"use client";

import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { Input } from "@/shared/components/Input";
import { formatRefUsd } from "@/shared/utils/currency";

import { commissionForSale, shareOfGrossProfit } from "../../utils/payrollMath";

export type PayrollSimulatorProps = {
  /** Promedio de `grossProfitRef` de las ultimas quincenas calculadas; `null` si no hay. */
  averageGrossProfitRef: number | null;
  /** Cuantas quincenas entraron en el promedio (para el texto). */
  periodsInAverage: number;
  /** Porcentaje por defecto de la configuracion, como valor inicial. */
  defaultCommissionPct: number;
};

/**
 * "Con ventas de X REF al Y %, la comision seria Z; eso es W % de la ganancia bruta
 * promedio de las ultimas 3 quincenas." Se recalcula en vivo mientras se escribe.
 */
export function PayrollSimulator({
  averageGrossProfitRef,
  defaultCommissionPct,
  periodsInAverage,
}: PayrollSimulatorProps) {
  const [salesRef, setSalesRef] = useState("1000");
  const [commissionPct, setCommissionPct] = useState(String(defaultCommissionPct));

  const salesNumber = Number(salesRef) || 0;
  const pctNumber = Number(commissionPct) || 0;
  const commissionRef = commissionForSale(salesNumber, pctNumber);
  const sharePct = shareOfGrossProfit(commissionRef, averageGrossProfitRef);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulador</CardTitle>
        <CardDescription>
          Prueba un porcentaje antes de guardarlo. No modifica ninguna quincena.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            helperText="Ventas cobradas del cajero en la quincena."
            label="Ventas (REF)"
            min="0"
            onChange={(event) => setSalesRef(event.target.value)}
            step="0.01"
            type="number"
            value={salesRef}
          />
          <Input
            helperText="Porcentaje de comision a simular."
            label="Comision (%)"
            max="100"
            min="0"
            onChange={(event) => setCommissionPct(event.target.value)}
            step="0.01"
            type="number"
            value={commissionPct}
          />
        </div>

        <p
          className="rounded-md bg-indigo-50 px-3 py-2 text-sm leading-6 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          data-testid="payroll-simulator-result"
        >
          Con ventas de {formatRefUsd(salesNumber)} al {pctNumber.toFixed(2)} %, la comision seria{" "}
          <strong className="tabular-nums">{formatRefUsd(commissionRef)}</strong>
          {sharePct == null
            ? "; todavia no tenemos ganancia bruta promedio para comparar."
            : `; eso es ${sharePct.toFixed(2)} % de la ganancia bruta promedio de las ultimas ${String(periodsInAverage)} quincenas (${formatRefUsd(averageGrossProfitRef ?? 0)}).`}
        </p>
      </CardContent>
    </Card>
  );
}
