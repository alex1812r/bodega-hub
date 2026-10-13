import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import MockDate from "mockdate";
import { delay, http, HttpResponse } from "msw";

import {
  getDashboardLowStock,
  getDashboardMetrics,
  getDashboardSalesTrend,
  getDashboardSummary,
  getRecentSales,
} from "@/modules/dashboard/services/dashboard.mock-server";
import { getDailyCloseSummary } from "@/modules/reports/services/dailyCloseSummary.mock-server";
import { parseAgingQuery } from "@/modules/reports/services/moneyReports";
import { getReceivablesAgingReport } from "@/modules/reports/services/moneyReports.mock-server";
import { getPaymentMethodsReport } from "@/modules/reports/services/paymentMethodsReport.mock-server";
import {
  buildDailySalesSeries,
  parseReportSeriesParams,
  resolveReportSeriesRequest,
  seriesFetchRange,
} from "@/modules/reports/services/reportSeries";
import { salesTrendFromSeries } from "@/modules/dashboard/services/salesTrend";
import { shiftIsoDate } from "@/modules/dashboard/utils/businessDate";
import { permissions, rolePermissions, userRoles } from "@/shared/auth/permissions";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import DashboardPage from "./page";

/**
 * `parameters.msw.handlers` de una story SUSTITUYE a la lista global de Storybook:
 * todo lo que pide el dashboard tiene que estar aquí, sesión incluida. Sin
 * `/api/auth/me` no hay permisos y las tarjetas por rol ni se piden ni se pintan.
 * La sesión es de administrador: ve todas las tarjetas.
 */
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
  http.get("/api/auth/me", () =>
    HttpResponse.json({
      data: {
        deniedPermissions: [],
        grantedPermissions: [],
        permissionCatalog: permissions,
        permissions: rolePermissions.admin,
        role: "admin",
        roles: userRoles,
        storeId: DEFAULT_STORE_ID,
        user: { email: "admin@example.com", id: "user-admin", isActive: true, name: "Usuario admin" },
      },
    }),
  ),
  // Avisos de la columna de atención: por defecto, sin productos por revisar y
  // con las cuentas por cobrar de los datos de prueba. Las stories que enseñan
  // una tarjeta ponen SU respuesta delante (en MSW gana el primer handler que casa).
  http.get("/api/products/price-review/summary", () => HttpResponse.json({ data: { total: 0 } })),
  http.get("/api/reports/receivables-aging", ({ request }) =>
    HttpResponse.json({
      data: getReceivablesAgingReport(
        parseAgingQuery(new URL(request.url).searchParams),
        DEFAULT_STORE_ID,
      ),
    }),
  ),
];

const meta = {
  // Los datos de prueba son de mayo de 2026: el "hoy" de las stories es su último día.
  beforeEach() {
    MockDate.set("2026-05-18T16:00:00.000Z");
  },
  component: DashboardPage,
  parameters: {
    msw: {
      handlers: dashboardHandlers,
    },
    // El periodo del dashboard vive en la URL (`useUrlListState`): necesita el router de app.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/dashboard" },
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
        http.get("/api/products/price-review/summary", () =>
          HttpResponse.json({ data: { total: 3 } }),
        ),
        ...dashboardHandlers,
      ],
    },
  },
};

/** REP-09b: cuentas por cobrar con más de 30 días (y de 8 a 30) encima de "Bajo stock". */
export const WithOverdueReceivables: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/reports/receivables-aging", () =>
          HttpResponse.json({
            data: {
              items: [],
              limit: 10,
              skip: 0,
              summary: {
                buckets: [
                  { bucket: "0-7", documentsCount: 6, pendingRef: 84.5, pendingVes: 43095 },
                  { bucket: "8-30", documentsCount: 4, pendingRef: 61.2, pendingVes: 31212 },
                  { bucket: "30+", documentsCount: 3, pendingRef: 128.75, pendingVes: 65662.5 },
                ],
                totals: { documentsCount: 13, pendingRef: 274.45, pendingVes: 139969.5 },
              },
              total: 13,
            },
          }),
        ),
        ...dashboardHandlers,
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
