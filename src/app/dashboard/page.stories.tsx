import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";

import {
  getDashboardLowStock,
  getDashboardMetrics,
  getDashboardSalesTrend,
  getDashboardSummary,
  getRecentSales,
} from "@/modules/dashboard/services/dashboard.mock-server";
import { getDailyCloseSummary } from "@/modules/reports/services/dailyCloseSummary.mock-server";
import { getPaymentMethodsReport } from "@/modules/reports/services/paymentMethodsReport.mock-server";
import {
  buildDailySalesSeries,
  parseReportSeriesParams,
  resolveReportSeriesRequest,
  seriesFetchRange,
} from "@/modules/reports/services/reportSeries";
import { salesTrendFromSeries } from "@/modules/dashboard/services/salesTrend";
import { shiftIsoDate } from "@/modules/dashboard/utils/businessDate";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import DashboardPage from "./page";

const dashboardHandlers = [
  http.get("/api/dashboard/summary", () =>
    HttpResponse.json({ data: getDashboardSummary(DEFAULT_STORE_ID) }),
  ),
  http.get("/api/dashboard/metrics", ({ request }) =>
    HttpResponse.json({
      data: getDashboardMetrics(new URL(request.url).searchParams, DEFAULT_STORE_ID),
    }),
  ),
  http.get("/api/dashboard/daily-close", ({ request }) =>
    HttpResponse.json({
      data: getDailyCloseSummary(new URL(request.url).searchParams, DEFAULT_STORE_ID),
    }),
  ),
  http.get("/api/dashboard/sales-trend", ({ request }) =>
    HttpResponse.json({
      data: getDashboardSalesTrend(new URL(request.url).searchParams, DEFAULT_STORE_ID),
    }),
  ),
  http.get("/api/dashboard/recent-sales", ({ request }) =>
    HttpResponse.json({
      data: getRecentSales(new URL(request.url).searchParams, DEFAULT_STORE_ID),
    }),
  ),
  http.get("/api/dashboard/low-stock", ({ request }) =>
    HttpResponse.json({
      data: getDashboardLowStock(new URL(request.url).searchParams, DEFAULT_STORE_ID),
    }),
  ),
  http.get("/api/reports/payment-methods", ({ request }) =>
    HttpResponse.json({
      data: getPaymentMethodsReport(new URL(request.url).searchParams, DEFAULT_STORE_ID),
    }),
  ),
];

const meta = {
  component: DashboardPage,
  parameters: {
    msw: {
      handlers: dashboardHandlers,
    },
  },
  title: "App/Dashboard/DashboardPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof DashboardPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** PRO-11: con productos en "Por revisar" la tarjeta aparece encima de "Bajo stock". */
export const WithPriceReview: Story = {
  parameters: {
    msw: {
      handlers: [
        ...dashboardHandlers,
        http.get("/api/products/price-review/summary", () =>
          HttpResponse.json({ data: { total: 3 } }),
        ),
      ],
    },
  },
};

/** Ventas REF de un ciclo de dos semanas, con tres picos claros. */
const PEAK_PATTERN = [120, 180, 140, 420, 210, 160, 90, 130, 510, 170, 150, 380, 200, 110];

/**
 * REP-09a: flujo de ventas con picos y periodo anterior, para cualquier periodo
 * que se elija (la serie se genera para el rango pedido). Captura de QA visual.
 */
export const WithSalesPeaks: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/dashboard/sales-trend", ({ request }) => {
          const seriesRequest = resolveReportSeriesRequest(
            parseReportSeriesParams(new URL(request.url).searchParams),
          );

          if (!seriesRequest) {
            return HttpResponse.json({ data: salesTrendFromSeries(undefined) });
          }

          const { from, to } = seriesFetchRange(seriesRequest);
          const rows = [];

          for (let day = from, index = 0; day <= to; day = shiftIsoDate(day, 1), index += 1) {
            // El periodo anterior vende menos: el delta de la cabecera sale positivo.
            const factor = day < seriesRequest.range.from ? 0.8 : 1;
            const totalRef = PEAK_PATTERN[index % PEAK_PATTERN.length] * factor;

            rows.push({
              day,
              values: {
                count: Math.max(1, Math.round(totalRef / 40)),
                paidVes: totalRef * 510,
                totalRef,
                totalVes: totalRef * 510,
              },
            });
          }

          return HttpResponse.json({
            data: salesTrendFromSeries(buildDailySalesSeries(seriesRequest, rows)),
          });
        }),
        ...dashboardHandlers,
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/dashboard/summary", async () => {
          await delay(10_000);
          return HttpResponse.json({ data: getDashboardSummary(DEFAULT_STORE_ID) });
        }),
        ...dashboardHandlers.slice(1),
      ],
    },
  },
};

export const Error: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/dashboard/summary", () =>
          HttpResponse.json(
            {
              error: {
                code: "INTERNAL_ERROR",
                message: "No se pudo cargar el resumen del dashboard.",
              },
            },
            { status: 500 },
          ),
        ),
        ...dashboardHandlers.slice(1),
      ],
    },
  },
};
