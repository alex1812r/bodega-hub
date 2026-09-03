import { z } from "zod";

import { getStoreCapitalSummary as getStoreCapitalSummaryMock } from "@/modules/assistant/services/capital.mock-server";
import { getStoreCapitalSummary as getStoreCapitalSummaryServer } from "@/modules/assistant/services/capital.server";

import { registerTool } from "../toolRegistry";

import { fail, ok, runService } from "./_shared";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

export const CAPITAL_FORMULA =
  "capital = baul (REF + Bs convertidos a la tasa de hoy) + inventario a costo + cuentas por cobrar - cuentas por pagar";

export const CAPITAL_NOTE =
  "El saldo del baul depende de que los cierres de caja esten transferidos.";

export const capitalActual = registerTool<Input>({
  description: `Capital actual de la tienda con cada componente por separado. Formula: ${CAPITAL_FORMULA}. Devuelve el total en REF y su equivalente en Bs a la tasa del dia.`,
  examples: [
    "cual es el capital actual",
    "cuanto vale el negocio hoy",
    "cuanto tenemos entre baul, inventario y cuentas",
  ],
  inputSchema,
  name: "capital_actual",
  scope: "store",
  execute: async (_input, ctx) => {
    const [summary] = await runService(ctx, {
      mock: () => getStoreCapitalSummaryMock(ctx.storeIds),
      server: (options) => getStoreCapitalSummaryServer(ctx.storeIds, options),
    });

    if (!summary) {
      return fail("No se pudo calcular el capital de la tienda.");
    }

    return ok(
      "capital_actual",
      {
        capitalRef: summary.capitalRef,
        capitalVes: summary.capitalVes,
        componentes: {
          baulCuentaBs: summary.vaultCuentaVes,
          baulEfectivoBs: summary.vaultEfectivoVes,
          baulRef: summary.vaultRef,
          baulTotalBsEnRef: summary.vaultTotalVesEnRef,
          cuentasPorCobrarRef: summary.cuentasPorCobrarRef,
          cuentasPorPagarRef: summary.cuentasPorPagarRef,
          inventarioACostoRef: summary.inventarioCostoRef,
        },
        formula: CAPITAL_FORMULA,
        tasaVes: summary.tasaVes,
      },
      { note: CAPITAL_NOTE },
    );
  },
});
