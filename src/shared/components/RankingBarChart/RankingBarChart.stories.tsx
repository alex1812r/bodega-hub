import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { Card } from "@/shared/components/Card";

import { RankingBarChart } from "./RankingBarChart";
import type { RankingBarItem } from "./rankingData";

const PRODUCTS: RankingBarItem[] = [
  { id: "p1", label: "Harina de maíz precocida blanca 1 kg", value: 412.5 },
  { id: "p2", label: "Arroz tipo I 1 kg", value: 388 },
  { id: "p3", label: "Aceite vegetal 1 L", value: 301.2 },
  { id: "p4", label: "Café molido 500 g", value: 276.4 },
  { id: "p5", label: "Azúcar refinada 1 kg", value: 240 },
  { id: "p6", label: "Pasta larga 1 kg", value: 198.75 },
  { id: "p7", label: "Queso blanco duro (kg)", value: 176.3 },
  { id: "p8", label: "Leche en polvo completa 900 g", value: 150 },
  { id: "p9", label: "Margarina con sal 500 g", value: 97.6 },
  { id: "p10", label: "Sardinas en aceite 170 g", value: 64.2 },
  { id: "p11", label: "Sal refinada 1 kg", value: 31 },
  { id: "p12", label: "Vinagre blanco 500 ml", value: 12.4 },
];

const PAYMENT_METHODS: RankingBarItem[] = [
  { deltaPct: 18.4, id: "pago_movil", label: "Pago móvil", previousValue: 820, value: 971 },
  { deltaPct: -12.5, id: "efectivo_usd", label: "Efectivo USD", previousValue: 640, value: 560 },
  { deltaPct: 0, id: "punto_venta", label: "Punto de venta", previousValue: 410, value: 410 },
  { deltaPct: null, id: "transferencia", label: "Transferencia", previousValue: 0, value: 95 },
  { deltaPct: null, id: "efectivo_ves", label: "Efectivo VES", previousValue: null, value: 20 },
];

const mobileViewport = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  parameters: {
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
          type: "mobile",
        },
      },
    },
  },
} as const;

const meta = {
  component: RankingBarChart,
  tags: ["ai-generated"],
  args: {
    ariaLabel: "Top productos",
    items: PRODUCTS,
  },
  decorators: [
    (Story) => (
      <Card className="p-4">
        <Story />
      </Card>
    ),
  ],
} satisfies Meta<typeof RankingBarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 12 elementos: se dibujan los 10 mayores, ordenados, con el valor al final de la barra. */
export const TopTen: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("img")).toHaveAccessibleName(/^Top productos: 10 elementos/);
    await expect(canvasElement.querySelectorAll("g[data-rank]")).toHaveLength(10);
  },
};

/** El mismo ranking en el tema oscuro. */
export const TopTenDark: Story = {
  globals: { theme: "dark" },
};

/** `topN={5}`. */
export const TopFive: Story = {
  args: { topN: 5 },
};

/** Unidades en vez de dinero con `formatValue`. */
export const Units: Story = {
  args: { formatValue: (value: number) => `${Math.round(value)} uds` },
};

/** Rentabilidad con pérdidas: línea de cero y barras hacia la izquierda. */
export const WithLosses: Story = {
  args: {
    ariaLabel: "Rentabilidad por producto",
    items: [
      { id: "a", label: "Café molido 500 g", value: 184.2 },
      { id: "b", label: "Queso blanco duro (kg)", value: 96 },
      { id: "c", label: "Harina de maíz precocida blanca 1 kg", value: 12.5 },
      { id: "d", label: "Leche en polvo completa 900 g", value: -38.4 },
      { id: "e", label: "Sardinas en aceite 170 g", value: -71 },
    ],
  },
};

/** Métodos de pago comparados con el periodo anterior: barra fina atenuada y variación. */
export const WithPreviousPeriod: Story = {
  args: { ariaLabel: "Métodos de pago", items: PAYMENT_METHODS },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('rect[data-bar="previous"]')).toHaveLength(4);
  },
};

/** La comparación en oscuro. */
export const WithPreviousPeriodDark: Story = {
  args: WithPreviousPeriod.args,
  globals: { theme: "dark" },
};

/** 390 px: el nombre va encima de la barra y se recorta sin provocar scroll horizontal. */
export const Mobile: Story = {
  ...mobileViewport,
  name: "390 px",
};

/** 390 px con comparación: el texto «Antes …» comparte línea con el nombre sin pisarlo. */
export const MobileWithPreviousPeriod: Story = {
  ...mobileViewport,
  args: WithPreviousPeriod.args,
  name: "390 px con periodo anterior",
};

/** Una sola fila. */
export const SingleRow: Story = {
  args: { items: [PRODUCTS[0]] },
};

/** Todo en 0: filas sin barra, sin errores. */
export const AllZero: Story = {
  args: { items: PRODUCTS.slice(0, 4).map((item) => ({ ...item, value: 0 })) },
};

export const Loading: Story = {
  args: { loading: true },
};

export const Empty: Story = {
  args: {
    emptyDescription: "No hubo ventas en el rango elegido.",
    emptyTitle: "Sin ventas",
    items: [],
  },
};

export const ErrorWithRetry: Story = {
  args: { error: "No hay conexión con el servidor.", items: [], onRetry: fn() },
  name: "Error",
};
