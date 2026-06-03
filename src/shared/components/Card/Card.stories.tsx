import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "../Badge";
import { Button } from "../Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

const meta = {
  component: Card,
  tags: ["ai-generated"],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Metric: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardDescription>Ventas del dia</CardDescription>
        <CardTitle>ref 320.00</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-500">Equivalente: Bs. 163.200,00</p>
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Factura V-0001</CardTitle>
          <Badge variant="success">Pagada</Badge>
        </div>
        <CardDescription>Cliente: Luis Martinez</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-600">
          Total: ref 22.00 / Bs. 11.220,00
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Ver detalle</Button>
        <Button size="sm" variant="outline">
          Imprimir
        </Button>
      </CardFooter>
    </Card>
  ),
};
