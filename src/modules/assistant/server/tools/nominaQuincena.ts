import { z } from "zod";

import { getPayrollCurrent as getPayrollCurrentMock } from "@/modules/payroll/services/payroll.mock-server";
import { getPayrollCurrent as getPayrollCurrentServer } from "@/modules/payroll/services/payroll.server";
import { listPayrollPeriods as listPayrollPeriodsMock } from "@/modules/payroll/services/payroll.mock-server";
import { listPayrollPeriods as listPayrollPeriodsServer } from "@/modules/payroll/services/payroll.server";
import { isPayrollPeriodKey } from "@/modules/payroll/utils/quincena";

import { registerTool } from "../toolRegistry";

import { fail, failFromError, ok, runService } from "./_shared";

const inputSchema = z.object({
  quincena: z
    .string()
    .optional()
    .describe(
      "Clave de la quincena en formato YYYY-MM-Q1 (dia 1 al 15) o YYYY-MM-Q2 (dia 16 al fin de mes). Omitir para la quincena en curso.",
    ),
});

type Input = z.infer<typeof inputSchema>;

/**
 * La comision de los cajeros. Sin `quincena` responde con la estimacion viva de
 * la quincena en curso (que todavia no se puede pagar); con una clave concreta
 * devuelve el snapshot guardado de esa quincena.
 */
export const nominaQuincena = registerTool<Input>({
  description:
    "Nomina de los cajeros por quincena: ventas comisionables, comision, reversos, total y estado (borrador, aprobado o pagado). Sin argumentos devuelve la estimacion de la quincena en curso.",
  examples: [
    "cuanto le toca a los cajeros esta quincena",
    "cuanto pagamos de comisiones en la quincena pasada",
    "nomina de 2026-08-Q2",
  ],
  inputSchema,
  name: "nomina_quincena",
  scope: "store",
  execute: async (input, ctx) => {
    const storeId = ctx.storeIds[0];

    if (!storeId) {
      return fail("Necesito una tienda para consultar la nomina.");
    }

    try {
      if (!input.quincena) {
        const current = await runService(ctx, {
          mock: () => getPayrollCurrentMock(storeId),
          server: () => getPayrollCurrentServer(storeId),
        });

        return ok(
          "nomina_quincena",
          {
            comisionEstimadaActual: current.estimateTotalRef,
            cajeros: current.estimate.map((row) => ({
              cajero: row.fullName,
              comisionRef: row.totalRef,
              porcentaje: row.commissionPct,
              ventas: row.salesCount,
              ventasRef: row.salesRef,
            })),
            quincenaAnterior: current.previousPeriod
              ? {
                  estado: current.previousPeriod.status,
                  quincena: current.previousPeriod.periodKey,
                  totalRef: current.previousPeriod.totalRef,
                }
              : null,
            quincenaEnCurso: current.currentPeriodKey,
          },
          {
            note: "La quincena en curso es una estimacion viva: cambia con cada venta cobrada y solo se puede calcular cuando termina.",
          },
        );
      }

      if (!isPayrollPeriodKey(input.quincena)) {
        return fail(
          `"${input.quincena}" no es una quincena valida. Usa YYYY-MM-Q1 o YYYY-MM-Q2, por ejemplo 2026-08-Q2.`,
        );
      }

      const params = new URLSearchParams({ limit: "60" });
      const periods = await runService(ctx, {
        mock: () => listPayrollPeriodsMock(params, storeId),
        server: () => listPayrollPeriodsServer(params, storeId),
      });

      const period = periods.items.find((row) => row.periodKey === input.quincena);

      if (!period) {
        return fail(
          `Todavia no se ha calculado la quincena ${input.quincena}.`,
          periods.items.slice(0, 6).map((row) => row.periodKey),
        );
      }

      return ok("nomina_quincena", {
        comisionRef: period.commissionRef,
        estado: period.status,
        gananciaBrutaRef: period.grossProfitRef,
        participacionEnGananciaBrutaPorcentaje: period.shareOfGrossProfitPct,
        quincena: period.periodKey,
        reversosRef: period.reversalRef,
        totalRef: period.totalRef,
        ventasComisionablesRef: period.salesRef,
      });
    } catch (error) {
      return failFromError(error, "No se pudo consultar la nomina.");
    }
  },
});
