import { z } from "zod";

import { getPaymentMethodsReport as getPaymentMethodsReportMock } from "@/modules/reports/services/paymentMethodsReport.mock-server";
import { getPaymentMethodsReport as getPaymentMethodsReportServer } from "@/modules/reports/services/paymentMethodsReport.server";

import { resolveRange } from "../dates";
import { registerTool } from "../toolRegistry";

import { buildParams, money, ok, runService } from "./_shared";
import { rangeShape } from "./schemas";

const inputSchema = z.object(rangeShape);

type Input = z.infer<typeof inputSchema>;

export const metodosPago = registerTool<Input>({
  description:
    "Mix de cobros por metodo de pago (efectivo, pago movil, transferencia, punto, zelle, etc.) en un periodo, con monto en REF y Bs y numero de pagos.",
  examples: [
    "cuanto entro por pago movil esta semana",
    "como se reparten los cobros por metodo",
    "cuanto cobramos en efectivo este mes",
  ],
  inputSchema,
  name: "metodos_pago",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "este_mes");
    const params = buildParams({ limit: 100, range });
    const report = await runService(ctx, {
      mock: () => getPaymentMethodsReportMock(params, ctx.storeIds),
      server: (options) => getPaymentMethodsReportServer(params, ctx.storeIds, options),
    });

    const totalVes = report.summary.totalVes;

    return ok(
      "metodos_pago",
      {
        metodos: report.items.map((row) => ({
          metodo: row.method,
          montoRef: money(row.amountRef),
          montoVes: money(row.amountVes),
          pagos: row.paymentCount,
          participacionPorcentaje: totalVes > 0 ? money((row.amountVes / totalVes) * 100) : null,
        })),
        totalPagos: report.summary.paymentCount,
        totalRef: money(report.summary.totalRef),
        totalVes: money(totalVes),
      },
      {
        range,
        ...(report.items.length === 0
          ? { note: "No hay cobros registrados en ese rango." }
          : {}),
      },
    );
  },
});
