import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Card, CardContent, CardHeader, CardTitle } from "../Card";
import { AppShell } from "./AppShell";

const meta = {
  component: AppShell,
  tags: ["ai-generated"],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DashboardLayout: Story = {
  args: {
    currentPath: "/dashboard",
    refRateVes: 510,
    userName: "Alex Admin",
    userRole: "admin",
    children: (
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Ventas del dia</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">ref 320.00</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">8 productos</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pagos pendientes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">Bs. 14.200,00</p>
          </CardContent>
        </Card>
      </div>
    ),
  },
};
