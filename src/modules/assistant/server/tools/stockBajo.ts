import { z } from "zod";

import { getLowStockReport as getLowStockReportMock } from "@/modules/reports/services/reports.mock-server";
import { getLowStockReport as getLowStockReportServer } from "@/modules/reports/services/reports.server";

import { registerTool } from "../toolRegistry";

import { buildParams, clampLimit, clampList, money, ok, runService } from "./_shared";
import { limitShape } from "./schemas";

const inputSchema = z.object(limitShape);

type Input = z.infer<typeof inputSchema>;

type LowStockRow = {
  currentCostRef: number;
  currentStock: number;
  minStock: number;
  name: string;
  sku: string;
};

export const stockBajo = registerTool<Input>({
  description:
    "Productos con stock actual en o por debajo del minimo, es decir lo que hay que reponer. No depende de fechas.",
  examples: [
    "que productos hay que reponer",
    "que esta por agotarse",
    "cuantos productos estan bajo el minimo",
  ],
  inputSchema,
  name: "stock_bajo",
  scope: "store",
  execute: async (input, ctx) => {
    const limit = clampLimit(input.limit, 20);
    const params = buildParams({ limit: 100 });
    const report = await runService(ctx, {
      mock: () => getLowStockReportMock(params, ctx.storeIds),
      server: (options) => getLowStockReportServer(params, ctx.storeIds, options),
    });

    const rows = report.items as LowStockRow[];
    const { items, note } = clampList(rows, limit, report.total);

    return ok(
      "stock_bajo",
      {
        productos: items.map((item) => ({
          costoUnitarioRef: money(item.currentCostRef),
          faltante: Math.max(0, item.minStock - item.currentStock),
          nombre: item.name,
          sku: item.sku,
          stockActual: item.currentStock,
          stockMinimo: item.minStock,
        })),
        total: report.total,
      },
      {
        note:
          report.total === 0
            ? "No hay productos por debajo del minimo; no hace falta reponer nada."
            : note,
      },
    );
  },
});
