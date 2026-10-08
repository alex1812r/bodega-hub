"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ProductKardexPoint } from "../services/productKardex";

type ProductKardexBalanceChartProps = {
  series: ProductKardexPoint[];
};

/** `2026-10-08` → `08/10`. */
export function formatKardexDay(isoDate: string) {
  const [, month, day] = isoDate.split("-");

  return `${day}/${month}`;
}

function formatUnits(value: number) {
  return `${value} ${Math.abs(value) === 1 ? "unidad" : "unidades"}`;
}

/** Resumen del gráfico para lector de pantalla: de dónde parte el saldo y dónde termina. */
export function describeKardexSeries(series: ProductKardexPoint[]) {
  const known = series.filter(
    (point): point is ProductKardexPoint & { balance: number } => point.balance !== null,
  );

  if (known.length === 0) {
    return "Saldo de los últimos 30 días: sin datos.";
  }

  const first = known[0];
  const last = known[known.length - 1];
  const balances = known.map((point) => point.balance);

  return (
    `Saldo de los últimos ${series.length} días: de ${formatUnits(first.balance)} el ` +
    `${formatKardexDay(first.date)} a ${formatUnits(last.balance)} el ${formatKardexDay(last.date)}. ` +
    `Mínimo ${Math.min(...balances)}, máximo ${Math.max(...balances)}.`
  );
}

/**
 * Mini-gráfico del saldo diario. El eje parte de 0 o del saldo más bajo, lo que
 * sea menor: un saldo negativo histórico se dibuja bajo la línea de cero. Los
 * días sin dato (`balance: null`) dejan el hueco. Los mismos datos van en una
 * tabla solo para lector de pantalla.
 */
export function ProductKardexBalanceChart({ series }: ProductKardexBalanceChartProps) {
  const balances = series.flatMap((point) => (point.balance === null ? [] : [point.balance]));
  const lowest = Math.min(0, ...balances);
  const highest = Math.max(1, ...balances);

  return (
    <div>
      <div
        aria-label={describeKardexSeries(series)}
        className="h-40 w-full min-w-0"
        role="img"
      >
        <ResponsiveContainer height="100%" minHeight={160} minWidth={0} width="100%">
          <LineChart
            accessibilityLayer={false}
            data={series}
            margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
          >
            <CartesianGrid stroke="var(--outline-variant)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              interval="preserveStartEnd"
              minTickGap={24}
              tick={{ fill: "var(--on-surface-variant)", fontSize: 11 }}
              tickFormatter={formatKardexDay}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              domain={[lowest, highest]}
              tick={{ fill: "var(--on-surface-variant)", fontSize: 11 }}
              tickLine={false}
              width={36}
            />
            {lowest < 0 ? <ReferenceLine stroke="var(--error)" strokeDasharray="4 4" y={0} /> : null}
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--surface-container-lowest)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--foreground)",
                fontSize: 12,
              }}
              formatter={(value) => [String(value), "Saldo"]}
              labelFormatter={(label) => `Día ${formatKardexDay(String(label))}`}
            />
            <Line
              dataKey="balance"
              dot={false}
              isAnimationActive={false}
              stroke="var(--primary)"
              strokeWidth={2}
              type="linear"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Saldo diario de los últimos {series.length} días</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Entradas</th>
            <th scope="col">Salidas</th>
            <th scope="col">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatKardexDay(point.date)}</th>
              <td>{point.entries ?? "Sin dato"}</td>
              <td>{point.exits ?? "Sin dato"}</td>
              <td>{point.balance ?? "Sin dato"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
