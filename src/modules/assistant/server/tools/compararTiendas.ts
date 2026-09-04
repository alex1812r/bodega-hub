import { z } from "zod";

import { getStoreCapitalSummary as getStoreCapitalSummaryMock } from "@/modules/assistant/services/capital.mock-server";
import { getStoreCapitalSummary as getStoreCapitalSummaryServer } from "@/modules/assistant/services/capital.server";
import { getDashboardMetrics as getDashboardMetricsMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardMetrics as getDashboardMetricsServer } from "@/modules/dashboard/services/dashboard.server";
import { getGrossProfitReport as getGrossProfitReportMock } from "@/modules/reports/services/reports.mock-server";
import { getGrossProfitReport as getGrossProfitReportServer } from "@/modules/reports/services/reports.server";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

import { resolveRange } from "../dates";
import { listAssistantStores, resolveStoreRefs, StoreRefError } from "../storeRefs";
import { registerTool } from "../toolRegistry";

import { buildParams, clampList, fail, money, ok, runService } from "./_shared";
import { rangeShape } from "./schemas";

import type { AssistantToolContext, AssistantToolRange } from "../../types";

const inputSchema = z.object({
  ...rangeShape,
  metrica: z
    .enum(["capital", "ganancia", "todas", "ventas"])
    .optional()
    .describe('Que comparar. "todas" (default) trae ventas, ganancia y capital.'),
  tiendas: z
    .array(z.string())
    .optional()
    .describe(
      "Nombres o slugs de las tiendas a comparar. Vacio u omitido = todas las tiendas activas.",
    ),
});

type Input = z.infer<typeof inputSchema>;

type GrossProfitRow = { costRef: number; grossProfitRef: number; revenueRef: number; saleDate: string };

async function salesFor(ctx: AssistantToolContext, storeId: string, range: AssistantToolRange) {
  const params = buildParams({ range });

  return runService(ctx, {
    mock: () => getDashboardMetricsMock(params, [storeId]),
    server: (options) => getDashboardMetricsServer(params, [storeId], options),
  });
}

async function profitFor(ctx: AssistantToolContext, storeId: string, range: AssistantToolRange) {
  const params = buildParams({ limit: 100, range });
  const report = await runService(ctx, {
    mock: () => getGrossProfitReportMock(params, [storeId]),
    server: (options) => getGrossProfitReportServer(params, [storeId], options),
  });

  return (report.items as GrossProfitRow[])
    .filter((row) =>
      isUtcTimestampInCaracasDateRange(`${row.saleDate}T12:00:00.000Z`, range.from, range.to),
    )
    .reduce((total, row) => total + Number(row.grossProfitRef ?? 0), 0);
}

export const compararTiendas = registerTool<Input>({
  description:
    "Compara tiendas de la plataforma en un periodo: ventas (REF, Bs, cantidad), ganancia bruta y capital, con el ranking ordenado. Si una tienda no existe devuelve la lista de tiendas disponibles.",
  examples: [
    "cual es la tienda con mas ventas este mes",
    "compara Bodega Norte con Bodega Sur",
    "ganancia total de todas las tiendas en agosto",
    "que tienda tiene mas capital",
  ],
  inputSchema,
  name: "comparar_tiendas",
  scope: "platform",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "este_mes");
    const metric = input.metrica ?? "todas";
    const stores = await listAssistantStores();

    if (stores.length === 0) {
      return fail("No hay tiendas registradas en la plataforma.");
    }

    let selected = stores.filter((store) => store.isActive);

    if (input.tiendas && input.tiendas.length > 0) {
      try {
        selected = resolveStoreRefs(input.tiendas, stores);
      } catch (error) {
        if (error instanceof StoreRefError) {
          return fail(error.message, error.options);
        }

        throw error;
      }
    }

    if (selected.length === 0) {
      return fail(
        "No hay tiendas activas para comparar.",
        stores.map((store) => store.name),
      );
    }

    const wantsSales = metric === "todas" || metric === "ventas";
    const wantsProfit = metric === "todas" || metric === "ganancia";
    const wantsCapital = metric === "todas" || metric === "capital";

    const capitals = wantsCapital
      ? await runService(ctx, {
          mock: () => getStoreCapitalSummaryMock(selected.map((store) => store.id)),
          server: (options) =>
            getStoreCapitalSummaryServer(
              selected.map((store) => store.id),
              options,
            ),
        })
      : [];

    const rows = await Promise.all(
      selected.map(async (store, index) => {
        const metrics = wantsSales ? await salesFor(ctx, store.id, range) : null;
        const gananciaRef = wantsProfit ? await profitFor(ctx, store.id, range) : null;

        return {
          capitalRef: wantsCapital ? (capitals[index]?.capitalRef ?? 0) : null,
          gananciaRef: gananciaRef === null ? null : money(gananciaRef),
          tienda: store.name,
          ventasCantidad: metrics?.salesCount ?? null,
          ventasRef: metrics ? money(metrics.totalRef) : null,
          ventasVes: metrics ? money(metrics.totalVes) : null,
        };
      }),
    );

    const orderKey =
      metric === "capital" ? "capitalRef" : metric === "ganancia" ? "gananciaRef" : "ventasRef";
    const ranking = [...rows].sort(
      (first, second) => (second[orderKey] ?? 0) - (first[orderKey] ?? 0),
    );
    const { items, note } = clampList(ranking, 20, ranking.length);

    const totals = {
      capitalRef: wantsCapital ? money(rows.reduce((sum, row) => sum + (row.capitalRef ?? 0), 0)) : null,
      gananciaRef: wantsProfit ? money(rows.reduce((sum, row) => sum + (row.gananciaRef ?? 0), 0)) : null,
      ventasRef: wantsSales ? money(rows.reduce((sum, row) => sum + (row.ventasRef ?? 0), 0)) : null,
    };

    return ok(
      "comparar_tiendas",
      { metrica: metric, ordenadoPor: orderKey, ranking: items, totales: totals },
      {
        range,
        note: [
          input.tiendas?.length ? undefined : "Se compararon todas las tiendas activas.",
          note,
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      },
    );
  },
});
