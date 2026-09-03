import { z } from "zod";

import { getTopCustomersReport as getTopCustomersReportMock } from "@/modules/reports/services/reports.mock-server";
import { getTopCustomersReport as getTopCustomersReportServer } from "@/modules/reports/services/reports.server";

import { resolveRange } from "../dates";
import { registerTool } from "../toolRegistry";

import { buildParams, clampLimit, clampList, money, ok, runService } from "./_shared";
import { limitShape, rangeShape } from "./schemas";

const inputSchema = z.object({ ...rangeShape, ...limitShape });

type Input = z.infer<typeof inputSchema>;

type TopCustomerRow = {
  customerId: string;
  name: string;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export const topClientes = registerTool<Input>({
  description:
    "Ranking de clientes por monto comprado en un periodo, con numero de compras y totales en REF y Bs.",
  examples: [
    "quien es el mejor cliente",
    "top 3 clientes de este mes",
    "que cliente compro mas la semana pasada",
  ],
  inputSchema,
  name: "top_clientes",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "ultimos_30_dias");
    const limit = clampLimit(input.limit);
    const params = buildParams({ limit: 100, range });
    const report = await runService(ctx, {
      mock: () => getTopCustomersReportMock(params, ctx.storeIds),
      server: (options) => getTopCustomersReportServer(params, ctx.storeIds, options),
    });

    const rows = report.items as TopCustomerRow[];
    const { items, note } = clampList(rows, limit, report.total);

    return ok(
      "top_clientes",
      {
        ranking: items.map((item, index) => ({
          compras: item.salesCount,
          nombre: item.name,
          posicion: index + 1,
          totalRef: money(item.totalRef),
          totalVes: money(item.totalVes),
        })),
      },
      {
        range,
        note: rows.length === 0 ? "Ningun cliente registro compras en ese rango." : note,
      },
    );
  },
});
