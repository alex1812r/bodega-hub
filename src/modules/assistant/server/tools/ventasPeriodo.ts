import { z } from "zod";

import { getDashboardMetrics as getDashboardMetricsMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardMetrics as getDashboardMetricsServer } from "@/modules/dashboard/services/dashboard.server";
import { inclusiveIsoDayCount } from "@/modules/dashboard/utils/kpiPeriod";
import { shiftIsoDate } from "@/shared/utils/caracasBusinessDay";

import { resolveRange } from "../dates";
import { registerTool } from "../toolRegistry";

import { buildParams, money, ok, runService } from "./_shared";
import { rangeShape } from "./schemas";

import type { AssistantToolContext, AssistantToolRange } from "../../types";

const inputSchema = z.object({
  ...rangeShape,
  compararConPeriodoAnterior: z
    .boolean()
    .optional()
    .describe("true para comparar contra el periodo inmediatamente anterior de la misma duracion."),
});

type Input = z.infer<typeof inputSchema>;

async function metricsFor(ctx: AssistantToolContext, range: AssistantToolRange) {
  const params = buildParams({ range });

  return runService(ctx, {
    mock: () => getDashboardMetricsMock(params, ctx.storeIds),
    server: (options) => getDashboardMetricsServer(params, ctx.storeIds, options),
  });
}

function summarize(metrics: Awaited<ReturnType<typeof metricsFor>>) {
  return {
    salesCount: metrics.salesCount,
    ticketPromedioRef: metrics.salesCount > 0 ? money(metrics.totalRef / metrics.salesCount) : 0,
    totalRef: money(metrics.totalRef),
    totalVes: money(metrics.totalVes),
    unitsSold: metrics.unitsSold,
  };
}

export const ventasPeriodo = registerTool<Input>({
  description:
    "Total vendido en un periodo: numero de ventas, monto en REF y en Bs, unidades y ticket promedio. Opcionalmente compara contra el periodo anterior.",
  examples: [
    "cuanto se ha vendido desde ayer",
    "cuanto vendimos hoy",
    "ventas de la semana pasada comparadas con esta",
    "ventas del mes",
  ],
  inputSchema,
  name: "ventas_periodo",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "hoy");
    const current = summarize(await metricsFor(ctx, range));

    if (!input.compararConPeriodoAnterior) {
      return ok("ventas_periodo", { actual: current }, { range });
    }

    const days = inclusiveIsoDayCount(range.from, range.to);
    const previousRange: AssistantToolRange = {
      from: shiftIsoDate(range.from, -days),
      to: shiftIsoDate(range.from, -1),
    };
    const previous = summarize(await metricsFor(ctx, previousRange));
    const variacionPorcentajeRef =
      previous.totalRef > 0
        ? money(((current.totalRef - previous.totalRef) / previous.totalRef) * 100)
        : null;

    return ok(
      "ventas_periodo",
      { actual: current, anterior: { ...previous, rango: previousRange }, variacionPorcentajeRef },
      {
        range,
        ...(variacionPorcentajeRef === null
          ? { note: "El periodo anterior no tuvo ventas, no hay variacion porcentual." }
          : {}),
      },
    );
  },
});
