import { z } from "zod";

import { getGrossProfitReport as getGrossProfitReportMock } from "@/modules/reports/services/reports.mock-server";
import { getGrossProfitReport as getGrossProfitReportServer } from "@/modules/reports/services/reports.server";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

import { resolveRange } from "../dates";
import { registerTool } from "../toolRegistry";

import { buildParams, money, ok, runService } from "./_shared";
import { rangeShape } from "./schemas";

const inputSchema = z.object({
  ...rangeShape,
  agruparPor: z
    .enum(["dia", "mes"])
    .optional()
    .describe('Usa "mes" para preguntas del tipo "la ganancia de estos meses".'),
});

type Input = z.infer<typeof inputSchema>;

type GrossProfitRow = {
  costRef: number;
  grossProfitRef: number;
  revenueRef: number;
  saleDate: string;
};

export const gananciaBruta = registerTool<Input>({
  description:
    "Ganancia bruta (ingresos menos costo de lo vendido) en un periodo, con serie por dia o por mes. Todo en REF.",
  examples: [
    "cual es la ganancia entre el 1 y el 15 de agosto",
    "cual es la ganancia que hemos tenido estos meses",
    "cuanta utilidad dejamos este mes",
  ],
  inputSchema,
  name: "ganancia_bruta",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "este_mes");
    const params = buildParams({ limit: 100, range });
    const report = await runService(ctx, {
      mock: () => getGrossProfitReportMock(params, ctx.storeIds),
      server: (options) => getGrossProfitReportServer(params, ctx.storeIds, options),
    });

    // El mock de gross_profit_summary no filtra por fecha; lo hacemos aqui
    // para que ambas fuentes respeten el rango pedido.
    const rows = (report.items as GrossProfitRow[]).filter((row) =>
      isUtcTimestampInCaracasDateRange(`${row.saleDate}T12:00:00.000Z`, range.from, range.to),
    );

    const totals = rows.reduce(
      (accumulator, row) => ({
        costRef: accumulator.costRef + Number(row.costRef ?? 0),
        grossProfitRef: accumulator.grossProfitRef + Number(row.grossProfitRef ?? 0),
        revenueRef: accumulator.revenueRef + Number(row.revenueRef ?? 0),
      }),
      { costRef: 0, grossProfitRef: 0, revenueRef: 0 },
    );

    const groupBy = input.agruparPor ?? "dia";
    const buckets = new Map<string, { costRef: number; gananciaRef: number; ingresosRef: number }>();

    for (const row of rows) {
      const key = groupBy === "mes" ? row.saleDate.slice(0, 7) : row.saleDate;
      const current = buckets.get(key) ?? { costRef: 0, gananciaRef: 0, ingresosRef: 0 };

      buckets.set(key, {
        costRef: current.costRef + Number(row.costRef ?? 0),
        gananciaRef: current.gananciaRef + Number(row.grossProfitRef ?? 0),
        ingresosRef: current.ingresosRef + Number(row.revenueRef ?? 0),
      });
    }

    const serie = [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([periodo, values]) => ({
        costoRef: money(values.costRef),
        gananciaRef: money(values.gananciaRef),
        ingresosRef: money(values.ingresosRef),
        periodo,
      }));

    const margenPorcentaje =
      totals.revenueRef > 0 ? money((totals.grossProfitRef / totals.revenueRef) * 100) : null;

    return ok(
      "ganancia_bruta",
      {
        agrupadoPor: groupBy,
        costoTotalRef: money(totals.costRef),
        gananciaTotalRef: money(totals.grossProfitRef),
        ingresosTotalRef: money(totals.revenueRef),
        margenPorcentaje,
        serie,
      },
      {
        range,
        ...(serie.length === 0
          ? { note: "No hay ventas registradas en ese rango, la ganancia es cero." }
          : {}),
      },
    );
  },
});
