import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";

import {
  getDashboardLowStock,
  getDashboardSalesTrend,
  getDashboardSummary,
  getRecentSales,
} from "@/modules/dashboard/services/dashboard.mock-server";
import DashboardPage from "./page";

const dashboardHandlers = [
  http.get("/api/dashboard/summary", () =>
    HttpResponse.json({ data: getDashboardSummary() }),
  ),
  http.get("/api/dashboard/sales-trend", ({ request }) =>
    HttpResponse.json({
      data: getDashboardSalesTrend(new URL(request.url).searchParams),
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
