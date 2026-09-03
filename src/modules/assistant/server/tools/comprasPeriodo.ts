import { z } from "zod";

import {
  getPurchasesReport as getPurchasesReportMock,
  getSupplierPurchasesReport as getSupplierPurchasesReportMock,
} from "@/modules/reports/services/reports.mock-server";
import {
  getPurchasesReport as getPurchasesReportServer,
  getSupplierPurchasesReport as getSupplierPurchasesReportServer,
} from "@/modules/reports/services/reports.server";

import { resolveRange } from "../dates";
import { registerTool } from "../toolRegistry";

import { buildParams, clampList, money, ok, runService } from "./_shared";
import { rangeShape } from "./schemas";

const inputSchema = z.object({
  ...rangeShape,
  porProveedor: z
    .boolean()
    .optional()
    .describe("true para desglosar el acumulado por proveedor en lugar de listar compras."),
});

type Input = z.infer<typeof inputSchema>;

type PurchaseRow = {
  createdAt: string;
  purchaseNumber: string;
  status: string;
  supplier?: { name?: string } | null;
  totalRef: number;
  totalVes: number;
};

type SupplierRow = {
  name: string;
  pendingVes: number;
  purchasesCount: number;
  totalRef: number;
  totalVes: number;
};

const CANCELLED = new Set(["cancelado", "devuelto"]);

export const comprasPeriodo = registerTool<Input>({
  description:
    "Compras a proveedores en un periodo: total en REF y Bs, cantidad de compras y, si se pide, el desglose por proveedor.",
  examples: [
    "cuanto le hemos comprado a proveedores este mes",
    "cuanto compramos la semana pasada",
    "a que proveedor le compramos mas",
  ],
  inputSchema,
  name: "compras_periodo",
  scope: "store",
  execute: async (input, ctx) => {
    const range = resolveRange(input, ctx.today, "este_mes");
    const params = buildParams({ limit: 100, range });

    const report = await runService(ctx, {
      mock: () => getPurchasesReportMock(params, ctx.storeIds),
      server: (options) => getPurchasesReportServer(params, ctx.storeIds, options),
    });

    const purchases = (report.items as PurchaseRow[]).filter(
      (purchase) => !CANCELLED.has(purchase.status),
    );
    const totals = purchases.reduce(
      (accumulator, purchase) => ({
        totalRef: accumulator.totalRef + Number(purchase.totalRef ?? 0),
        totalVes: accumulator.totalVes + Number(purchase.totalVes ?? 0),
      }),
      { totalRef: 0, totalVes: 0 },
    );

    const resumen = {
      compras: purchases.length,
      totalRef: money(totals.totalRef),
      totalVes: money(totals.totalVes),
    };

    if (!input.porProveedor) {
      const { items, note } = clampList(purchases, 10, purchases.length);

      return ok(
        "compras_periodo",
        {
          detalle: items.map((purchase) => ({
            estado: purchase.status,
            fecha: purchase.createdAt,
            numero: purchase.purchaseNumber,
            proveedor: purchase.supplier?.name ?? "Sin proveedor",
            totalRef: money(purchase.totalRef),
          })),
          resumen,
        },
        {
          range,
          note: purchases.length === 0 ? "No hay compras registradas en ese rango." : note,
        },
      );
    }

    // El acumulado por proveedor es historico: se marca para no confundirlo con el rango.
    const supplierReport = await runService(ctx, {
      mock: () => getSupplierPurchasesReportMock(params, ctx.storeIds),
      server: (options) => getSupplierPurchasesReportServer(params, ctx.storeIds, options),
    });

    const suppliers = (supplierReport.items as SupplierRow[]).filter(
      (supplier) => supplier.purchasesCount > 0,
    );
    const { items, note } = clampList(suppliers, 20, suppliers.length);

    return ok(
      "compras_periodo",
      {
        porProveedor: items.map((supplier) => ({
          compras: supplier.purchasesCount,
          pendienteVes: money(supplier.pendingVes),
          proveedor: supplier.name,
          totalRef: money(supplier.totalRef),
          totalVes: money(supplier.totalVes),
        })),
        resumen,
      },
      {
        range,
        note: [
          "El desglose por proveedor es el acumulado historico, no solo el rango.",
          suppliers.length === 0 ? "No hay compras registradas a proveedores." : note,
        ]
          .filter(Boolean)
          .join(" "),
      },
    );
  },
});
