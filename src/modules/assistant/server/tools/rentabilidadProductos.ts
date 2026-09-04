import { z } from "zod";

import { getProductProfitabilityReport as getProductProfitabilityReportMock } from "@/modules/reports/services/reports.mock-server";
import { getProductProfitabilityReport as getProductProfitabilityReportServer } from "@/modules/reports/services/reports.server";

import { registerTool } from "../toolRegistry";

import { buildParams, clampLimit, clampList, money, ok, runService } from "./_shared";
import { limitShape } from "./schemas";

const inputSchema = z.object({
  ...limitShape,
  orden: z
    .enum(["mayor", "menor"])
    .optional()
    .describe('"mayor" (default) lista los de mas ganancia; "menor" los de menos.'),
});

type Input = z.infer<typeof inputSchema>;

type ProfitabilityRow = {
  costRef: number;
  grossProfitRef: number;
  name?: string;
  productId: string;
  revenueRef?: number;
  sku: string;
  unitsSold: number;
};

export const rentabilidadProductos = registerTool<Input>({
  description:
    "Margen por producto (acumulado historico): unidades vendidas, ingresos, costo, ganancia y margen porcentual en REF. No acepta rango de fechas.",
  examples: [
    "que producto deja mas margen",
    "cuales son los productos menos rentables",
    "rentabilidad por producto",
  ],
  inputSchema,
  name: "rentabilidad_productos",
  scope: "store",
  execute: async (input, ctx) => {
    const limit = clampLimit(input.limit);
    const params = buildParams({ limit: 100 });
    const report = await runService(ctx, {
      mock: () => getProductProfitabilityReportMock(params, ctx.storeIds),
      server: (options) => getProductProfitabilityReportServer(params, ctx.storeIds, options),
    });

    const rows = (report.items as ProfitabilityRow[]).filter((row) => row.unitsSold > 0);
    const sorted = [...rows].sort((first, second) =>
      input.orden === "menor"
        ? first.grossProfitRef - second.grossProfitRef
        : second.grossProfitRef - first.grossProfitRef,
    );
    const { items, note } = clampList(sorted, limit, sorted.length);

    return ok(
      "rentabilidad_productos",
      {
        orden: input.orden ?? "mayor",
        productos: items.map((item) => {
          const ingresosRef = money(item.revenueRef ?? item.costRef + item.grossProfitRef);

          return {
            costoRef: money(item.costRef),
            gananciaRef: money(item.grossProfitRef),
            ingresosRef,
            margenPorcentaje: ingresosRef > 0 ? money((item.grossProfitRef / ingresosRef) * 100) : null,
            nombre: item.name ?? item.sku,
            sku: item.sku,
            unidadesVendidas: item.unitsSold,
          };
        }),
      },
      {
        note:
          sorted.length === 0
            ? "Ningun producto registra ventas todavia, no hay margen que calcular."
            : note,
      },
    );
  },
});
