import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { Card } from "@/shared/components/Card";

import { HeatmapChart, type HeatmapAxisItem } from "./HeatmapChart";

const WEEKDAYS: HeatmapAxisItem[] = [
  { id: "1", label: "Lun", name: "lunes" },
  { id: "2", label: "Mar", name: "martes" },
  { id: "3", label: "Mié", name: "miércoles" },
  { id: "4", label: "Jue", name: "jueves" },
  { id: "5", label: "Vie", name: "viernes" },
  { id: "6", label: "Sáb", name: "sábado" },
  { id: "7", label: "Dom", name: "domingo" },
];

const HOURS: HeatmapAxisItem[] = Array.from({ length: 24 }, (_, hour) => ({
  id: String(hour),
  label: String(hour),
  name: `${String(hour).padStart(2, "0")}:00`,
}));

/** Una bodega: abre de 7 a 21, con pico al mediodía y al final de la tarde, más fuerte el sábado. */
const BY_WEEKDAY = WEEKDAYS.map((_, day) =>
  HOURS.map((__, hour) => {
    if (hour < 7 || hour > 20) {
      return 0;
    }

    const noon = Math.max(0, 4 - Math.abs(hour - 12));
    const evening = Math.max(0, 5 - Math.abs(hour - 18));

    return Math.round((noon * 14 + evening * 22 + 6) * (day === 5 ? 1.6 : day === 6 ? 0.5 : 1));
  }),
);

/** Los mismos datos traspuestos: 24 filas (horas) × 7 columnas (días), para 390 px. */
const BY_HOUR = HOURS.map((_, hour) => WEEKDAYS.map((__, day) => BY_WEEKDAY[day][hour]));

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
  component: HeatmapChart,
  tags: ["ai-generated"],
  args: {
    ariaLabel: "Ventas por día de la semana y hora",
    columnLabelEvery: 3,
    columns: HOURS,
    measureLabel: "REF vendido",
    rows: WEEKDAYS,
    values: BY_WEEKDAY,
  },
  decorators: [
    (Story) => (
      <Card className="w-full max-w-3xl p-4">
        <Story />
      </Card>
    ),
  ],
} satisfies Meta<typeof HeatmapChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 7 días × 24 horas: la intensidad de un solo tono del tema crece con el valor. */
export const Default: Story = {};

/** 390 px: traspuesto (horas en filas, días en columnas) para que cada celda se pueda tocar. */
export const Mobile: Story = {
  ...mobileViewport,
  args: { columnLabelEvery: 1, columns: WEEKDAYS, rows: HOURS, values: BY_HOUR },
  name: "390 px (traspuesto)",
};

/** Todo en 0: celdas neutras y leyenda «sin valores». */
export const AllZero: Story = {
  args: { values: WEEKDAYS.map(() => HOURS.map(() => 0)) },
};

export const Loading: Story = {
  args: { loading: true },
};

export const Empty: Story = {
  args: {
    emptyDescription: "No hubo ventas en el rango elegido.",
    emptyTitle: "Sin ventas",
    rows: [],
    values: [],
  },
};

export const ErrorWithRetry: Story = {
  args: { error: "No hay conexión con el servidor.", onRetry: fn() },
  name: "Error",
};
