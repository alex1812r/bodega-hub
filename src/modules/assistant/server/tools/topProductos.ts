import { z } from "zod";

import { getTopProductsReport as getTopProductsReportMock } from "@/modules/reports/services/reports.mock-server";
import { getTopProductsReport as getTopProductsReportServer } from "@/modules/reports/services/reports.server";

import { resolveRange } from "../dates";
import { resolveProductNames } from "../lookups";
import { registerTool } from "../toolRegistry";

import { buildParams, clampLimit, clampList, money, ok, runService } from "./_shared";
import { limitShape, rangeShape } from "./schemas";

const inputSchema = z.object({ ...rangeShape, ...limitShape });

type Input = z.infer<typeof inputSchema>;

type TopProductRow = {
  productId: string;
  revenueRef: number;
  sku: string;
  unitsSold: number;
};

export const topProductos = registerTool<Input>({
  description:
    "Ranking de productos mas vendidos en un periodo, con unidades vendidas e ingresos en REF.",
  examples: [
    "cual es el producto mas vendido",
    "top 5 productos de este mes",
    "que se vendio mas la semana pasada",
  ],
  inputSchema,
  name: "top_productos",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "ultimos_30_dias");
    const limit = clampLimit(input.limit);
    const params = buildParams({ limit: 100, range });
    const report = await runService(ctx, {
      mock: () => getTopProductsReportMock(params, ctx.storeIds),
      server: (options) => getTopProductsReportServer(params, ctx.storeIds, options),
    });

    const rows = report.items as TopProductRow[];
    const { items, note } = clampList(rows, limit, report.total);
    const names = await resolveProductNames(
      ctx,
      items.map((item) => item.productId),
    );

    return ok(
      "top_productos",
      {
        ranking: items.map((item, index) => ({
          ingresosRef: money(item.revenueRef),
          nombre: names.get(item.productId) ?? item.sku,
          posicion: index + 1,
          sku: item.sku,
          unidadesVendidas: item.unitsSold,
        })),
      },
      {
        range,
        note: rows.length === 0 ? "No hubo ventas de productos en ese rango." : note,
      },
    );
  },
});
