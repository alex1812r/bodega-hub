import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";

import {
  getDashboardLowStock,
  getDashboardMetrics,
  getDashboardSummary,
  getRecentSales,
} from "@/modules/dashboard/services/dashboard.mock-server";
import { getCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.mock-server";

import DashboardPage from "./page";

const dashboardHandlers = [
  http.get("/api/dashboard/summary", () =>
    HttpResponse.json({ data: getDashboardSummary() }),
  ),
  http.get("/api/dashboard/metrics", ({ request }) =>
    HttpResponse.json({
      data: getDashboardMetrics(new URL(request.url).searchParams),
    }),
  ),
  http.get("/api/dashboard/recent-sales", ({ request }) =>
    HttpResponse.json({
      data: getRecentSales(new URL(request.url).searchParams),
    }),
  ),
  http.get("/api/dashboard/low-stock", ({ request }) =>
    HttpResponse.json({
      data: getDashboardLowStock(new URL(request.url).searchParams),
    }),
  ),
  http.get("/api/exchange-rates/current", () =>
    HttpResponse.json({ data: getCurrentExchangeRate() }),
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

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/dashboard/summary", async () => {
          await delay(10_000);
          return HttpResponse.json({ data: getDashboardSummary() });
        }),
        http.get("/api/dashboard/metrics", async () => {
          await delay(10_000);
          return HttpResponse.json({
            data: getDashboardMetrics(
              new URLSearchParams("from=2026-05-18&to=2026-05-18"),
            ),
          });
        }),
        http.get("/api/exchange-rates/current", async () => {
          await delay(10_000);
          return HttpResponse.json({ data: getCurrentExchangeRate() });
        }),
        ...dashboardHandlers.slice(2),
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
