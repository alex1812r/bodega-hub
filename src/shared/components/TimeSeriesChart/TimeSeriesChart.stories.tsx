import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor } from "storybook/test";

import { Card } from "@/shared/components/Card";

import type { TimeSeriesPoint, TimeSeriesSeries } from "./chartData";
import { TimeSeriesChart } from "./TimeSeriesChart";

/** Tasa fija de las historias: 1 REF = 40 Bs. */
const RATE = 40;

function isoDay(start: string, offset: number) {
  const [year, month, day] = start.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

/** Ventas de un día, sin azar: base + ciclo semanal + ola larga + un extra los sábados. */
function dailyValue(index: number, base: number) {
  const weekly = [0.7, 0.85, 0.9, 1, 1.25, 1.6, 0.5][index % 7];
  const wave = 1 + Math.sin(index / 11) * 0.25;
  const jitter = ((index * 37) % 17) / 100;

  return Math.round(base * weekly * (wave + jitter) * 100) / 100;
}

function makeDays(length: number, start: string, base: number): TimeSeriesPoint[] {
  return Array.from({ length }, (_, index) => {
    const valueRef = dailyValue(index, base);

    return {
      count: Math.max(1, Math.round(valueRef / 9)),
      key: isoDay(start, index),
      valueRef,
      valueVes: Math.round(valueRef * RATE * 100) / 100,
    };
  });
}

function salesSeries(length: number, start: string): TimeSeriesSeries {
  return { id: "sales", name: "Ventas", points: makeDays(length, start, 180) };
}

const PAYMENT_METHODS = ["Efectivo", "Pago móvil", "Punto de venta", "Zelle", "Crédito"];

const meta = {
  component: TimeSeriesChart,
  tags: ["ai-generated"],
  args: {
    ariaLabel: "Ventas diarias",
    series: [salesSeries(7, "2024-03-25")],
  },
  decorators: [
    (Story) => (
      <Card className="p-4">
        <Story />
      </Card>
    ),
  ],
} satisfies Meta<typeof TimeSeriesChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 7 días: un marcador por punto y los 3 picos destacados con su valor. */
export const SevenDays: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await waitFor(() =>
      expect(canvasElement.querySelectorAll("[data-peak] text").length).toBeGreaterThan(0),
    );
    await expect(canvas.getByRole("img")).toHaveAccessibleName(/^Ventas diarias: 7 puntos/);

    await userEvent.click(canvas.getByRole("button", { name: "Bs" }));

    await expect(canvas.getByRole("button", { name: "Bs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(canvasElement.querySelector("[data-peak] text")?.textContent).toMatch(/^Bs\./),
    );
  },
};

/** 30 días: el eje X reduce etiquetas; los 3 picos son los mismos a cualquier ancho. */
export const ThirtyDays: Story = {
  args: { series: [salesSeries(30, "2024-03-02")] },
};

/** Los mismos 30 días en el tema oscuro. */
export const ThirtyDaysDark: Story = {
  args: ThirtyDays.args,
  globals: { theme: "dark" },
};

/** Solo el pico más alto. */
export const SinglePeak: Story = {
  args: { peakCount: 1, series: [salesSeries(30, "2024-03-02")] },
};

/** `peakCount={0}`: sin picos destacados. */
export const PeaksOff: Story = {
  args: { peakCount: 0, series: [salesSeries(30, "2024-03-02")] },
};

/** Periodo anterior: línea discontinua atenuada, alineada día a día con la actual. */
export const WithPreviousPeriod: Story = {
  args: {
    series: [
      {
        ...salesSeries(30, "2024-03-02"),
        previousPoints: makeDays(30, "2024-02-01", 150),
      },
    ],
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("Periodo anterior")).toBeVisible();
    await waitFor(() =>
      expect(canvasElement.querySelector(".time-series-previous path")).not.toBeNull(),
    );
  },
};

/** Periodo anterior en oscuro. */
export const WithPreviousPeriodDark: Story = {
  args: WithPreviousPeriod.args,
  globals: { theme: "dark" },
};

/** Periodo anterior vacío: no se dibuja ni aparece en la leyenda. */
export const EmptyPreviousPeriod: Story = {
  args: { series: [{ ...salesSeries(7, "2024-03-25"), previousPoints: [] }] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("Periodo anterior")).toBeNull();
  },
};

/** Un solo día: se dibuja el punto. */
export const SinglePoint: Story = {
  args: { series: [salesSeries(1, "2024-04-01")] },
};

/** Todo el rango en 0: el eje queda en 0–1. */
export const AllZero: Story = {
  args: {
    series: [
      {
        id: "sales",
        name: "Ventas",
        points: Array.from({ length: 7 }, (_, index) => ({
          count: 0,
          key: isoDay("2024-03-25", index),
          valueRef: 0,
          valueVes: 0,
        })),
      },
    ],
  },
};

export const Empty: Story = {
  args: { series: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Sin datos en este periodo")).toBeVisible();
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Cargando Ventas diarias" })).toBeVisible();
  },
};

export const LoadError: Story = {
  args: {
    error: "No se pudieron consultar las ventas del periodo.",
    onRetry: fn(),
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Reintentar" }));

    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};

/** 5 series con la paleta categórica: leyenda y picos sin etiqueta. */
export const FiveSeries: Story = {
  args: {
    ariaLabel: "Ventas por método de pago",
    series: PAYMENT_METHODS.map((name, index) => ({
      id: `method-${index}`,
      name,
      points: makeDays(30, "2024-03-02", 160 - index * 28).map((point, day) => ({
        ...point,
        valueRef: Math.round(point.valueRef * (1 + ((day + index * 3) % 5) / 10) * 100) / 100,
      })),
    })),
  },
};

/** Las 5 series en oscuro. */
export const FiveSeriesDark: Story = {
  args: FiveSeries.args,
  globals: { theme: "dark" },
};

/** Rango de 2 años (730 puntos): sin marcador por punto, solo los picos; el eje X lleva el año. */
export const TwoYears: Story = {
  args: { series: [salesSeries(730, "2022-04-02")] },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector("[data-peak]")).not.toBeNull());
    await expect(canvasElement.querySelectorAll(".recharts-line-dot")).toHaveLength(0);
  },
};

/** Compras por mes: etiquetas y títulos propios, conteo de «compras» y solo REF. */
export const MonthlyPurchases: Story = {
  args: {
    ariaLabel: "Compras por mes",
    countLabel: "compras",
    series: [
      {
        id: "purchases",
        name: "Compras",
        points: ["Nov", "Dic", "Ene", "Feb", "Mar", "Abr"].map((month, index) => ({
          count: 6 + ((index * 5) % 7),
          key: `month-${index}`,
          label: month,
          title: `${month} ${index < 2 ? 2023 : 2024}`,
          valueRef: [2150, 3480.5, 1920, 2610.75, 3050, 880][index],
        })),
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("group", { name: "Moneda del gráfico" })).toBeNull();
  },
};

/** Ganancia bruta con días en pérdida: el eje baja de 0 y marca la línea de cero. */
export const GrossProfitWithLosses: Story = {
  args: {
    ariaLabel: "Ganancia bruta",
    series: [
      {
        id: "profit",
        name: "Ganancia bruta",
        points: [42, 61.5, -18, 35, 88.25, -6.4, 54].map((valueRef, index) => ({
          key: isoDay("2024-03-25", index),
          valueRef,
          valueVes: valueRef * RATE,
        })),
      },
    ],
  },
};

const mobileViewport = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  parameters: {
    viewport: {
      options: {
        mobile390: { name: "Móvil 390", styles: { height: "844px", width: "390px" } },
      },
    },
  },
} satisfies Partial<Story>;

/** A 390 px: el eje X no solapa etiquetas y las de pico quedan dentro del área. */
export const Mobile: Story = {
  ...mobileViewport,
  args: WithPreviousPeriod.args,
};

/** A 390 px en oscuro, con 5 series: la leyenda salta de línea. */
export const MobileFiveSeriesDark: Story = {
  ...mobileViewport,
  args: FiveSeries.args,
  globals: { ...mobileViewport.globals, theme: "dark" },
};
