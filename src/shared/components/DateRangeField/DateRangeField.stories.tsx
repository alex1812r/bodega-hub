import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, within } from "storybook/test";

import { DateRangeField, type DateRangeFieldProps } from "./DateRangeField";
import type { DateRangeValue } from "./dateRangePresets";

const TODAY = "2026-10-09";

type DemoProps = Omit<DateRangeFieldProps, "onChange" | "value"> & {
  initialValue?: DateRangeValue;
};

function Demo({ initialValue = {}, ...props }: DemoProps) {
  const [value, setValue] = useState<DateRangeValue>(initialValue);

  return <DateRangeField today={TODAY} {...props} onChange={setValue} value={value} />;
}

const meta = {
  component: DateRangeField,
  tags: ["ai-generated"],
  args: {
    onChange: fn(),
    today: TODAY,
    value: {},
  },
} satisfies Meta<typeof DateRangeField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PorDefecto: Story = {
  name: "Por defecto",
  render: () => <Demo clearable label="Periodo" maxDate={TODAY} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Mes pasado" }));
    await expect(canvas.getByText("1–30 sep 2026")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Mes pasado" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};

export const ConPresetActivo: Story = {
  name: "Con preset activo",
  render: () => <Demo clearable initialValue={{ preset: "this_week" }} label="Periodo" />,
};

export const PersonalizadoAbierto: Story = {
  name: "Personalizado abierto",
  render: () => (
    <Demo initialValue={{ from: "2026-09-28", preset: "custom", to: "2026-10-06" }} maxDate={TODAY} />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "Personalizado" }));
    await expect(
      await body.findByRole("dialog", { name: "Elegir rango personalizado" }),
    ).toBeVisible();
    await expect(body.getByRole("button", { name: /10 de octubre de 2026/ })).toBeDisabled();
  },
};

export const Deshabilitado: Story = {
  args: { disabled: true, label: "Periodo", value: { preset: "today" } },
};

export const SubconjuntoDePresets: Story = {
  name: "Subconjunto de presets",
  render: () => (
    <Demo
      initialValue={{ preset: "today" }}
      label="Periodo"
      presets={["today", "yesterday", "last_30_days", "custom"]}
    />
  ),
};

export const TamanoSm: Story = {
  name: "Tamaño sm",
  render: () => <Demo initialValue={{ preset: "last_month" }} size="sm" />,
};

export const Mobile390: Story = {
  name: "390 px",
  globals: {
    viewport: { isRotated: false, value: "mobile390" },
  },
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
  render: () => <Demo clearable initialValue={{ preset: "last_month" }} label="Periodo" maxDate={TODAY} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "Personalizado" }));

    const calendar = await body.findByRole("dialog", { name: "Elegir rango personalizado" });
    const { left, right } = calendar.getBoundingClientRect();

    await expect(left).toBeGreaterThanOrEqual(0);
    await expect(right).toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth);
  },
};
