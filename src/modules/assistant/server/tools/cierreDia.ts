import { z } from "zod";

import { getDailyCloseSummary as getDailyCloseSummaryMock } from "@/modules/reports/services/dailyCloseSummary.mock-server";
import { getDailyCloseSummary as getDailyCloseSummaryServer } from "@/modules/reports/services/dailyCloseSummary.server";

import { resolveRange } from "../dates";
import { registerTool } from "../toolRegistry";

import { buildParams, money, ok, runService } from "./_shared";
import { isoDateSchema } from "./schemas";

const inputSchema = z.object({
  fecha: isoDateSchema.optional().describe("Dia a resumir. Por defecto hoy."),
  preset: z
    .enum(["hoy", "ayer"])
    .optional()
    .describe("Atajo para el dia operativo cuando no se da una fecha exacta."),
});

type Input = z.infer<typeof inputSchema>;

export const cierreDia = registerTool<Input>({
  description:
    "Resumen del cierre de un dia: ventas del dia, mix de metodos de pago, exposicion cambiaria, saldos del baul y estado de las cajas.",
  examples: [
    "como cerro el dia de ayer",
    "resumen del dia",
    "cuanto tenemos en el baul",
    "cuantas cajas quedaron abiertas",
  ],
  inputSchema,
  name: "cierre_dia",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(
      { from: input.fecha, preset: input.preset ?? undefined, to: input.fecha },
      ctx.today,
      "hoy",
    );
    const params = buildParams({ range });
    const summary = await runService(ctx, {
      mock: () => getDailyCloseSummaryMock(params, ctx.storeIds),
      server: (options) => getDailyCloseSummaryServer(params, ctx.storeIds, options),
    });

    return ok(
      "cierre_dia",
      {
        baul: summary.vault
          ? {
              efectivoBs: money(summary.vault.balanceEfectivoVes),
              cuentaBs: money(summary.vault.balanceVes),
              refUsd: money(summary.vault.balanceRef),
            }
          : null,
        cajas: summary.cash
          ? {
              cierresPendientes: summary.cash.pendingClosureCount,
              cierresPendientesRef: money(summary.cash.pendingClosureRef),
              sesionesAbiertas: summary.cash.openSessionCount,
              teoricoAbiertoRef: money(summary.cash.theoreticalOpenRef),
            }
          : null,
        cambiario: {
          perdidaPorDevaluacionRef: money(summary.fx.vesLossRef),
          tasaValoracionVes: money(summary.fx.valuationRateVes),
        },
        metodosPago: summary.payments.map((row) => ({
          metodo: row.method,
          montoRef: money(row.amountRef),
          montoVes: money(row.amountVes),
          pagos: row.paymentCount,
        })),
        ventas: {
          cantidad: summary.sales.salesCount,
          totalRef: money(summary.sales.totalRef),
          totalVes: money(summary.sales.totalVes),
        },
      },
      {
        range,
        note:
          summary.sales.salesCount === 0
            ? "No hubo ventas ese dia. Los saldos del baul dependen de que los cierres de caja esten transferidos."
            : "Los saldos del baul dependen de que los cierres de caja esten transferidos.",
      },
    );
  },
});
