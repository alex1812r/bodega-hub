import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, within } from "storybook/test";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { DateRangeField, type DateRangeFieldProps } from "./DateRangeField";
import {
  type AnyDateRangePreset,
  DATE_RANGE_PRESETS,
  type DateRangeValue,
  EXTENDED_DATE_RANGE_PRESETS,
} from "./dateRangePresets";

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
    // El rango va del 28 sep al 6 oct: abre en el mes del fin.
    await expect(body.getByRole("table", { name: "octubre de 2026" })).toBeVisible();
    await expect(body.getByRole("button", { name: /10 de octubre de 2026/ })).toBeDisabled();
  },
};

/** `minDate` y `maxDate`: solo se puede elegir del 5 al 9 de octubre. */
export const ConFechaMinima: Story = {
  name: "Con fecha mínima",
  render: () => (
    <Demo
      initialValue={{ from: "2026-10-06", preset: "custom", to: "2026-10-08" }}
      label="Periodo"
      maxDate={TODAY}
      minDate="2026-10-05"
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "Personalizado" }));
    await expect(
      await body.findByRole("dialog", { name: "Elegir rango personalizado" }),
    ).toBeVisible();
    await expect(body.getByRole("button", { name: "domingo, 4 de octubre de 2026" })).toBeDisabled();
    await expect(body.getByRole("button", { name: "lunes, 5 de octubre de 2026" })).toBeEnabled();
    await expect(body.getByRole("button", { name: "Mes anterior" })).toBeDisabled();
  },
};

/**
 * Dentro de un `Modal`: el calendario se monta en el propio diálogo (no en
 * `body`), así que se ve, se puede pulsar y no cierra el modal.
 */
export const DentroDeUnModal: Story = {
  name: "Dentro de un Modal",
  render: () => (
    <Modal
      bodyClassName="min-h-[28rem]"
      description="El rango se aplica al cerrar."
      title="Filtros del reporte"
      trigger={<Button>Abrir filtros</Button>}
    >
      <Demo clearable initialValue={{ preset: "this_month" }} label="Periodo" maxDate={TODAY} />
    </Modal>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "Abrir filtros" }));

    const modal = await body.findByRole("dialog", { name: "Filtros del reporte" });

    await userEvent.click(within(modal).getByRole("button", { name: "Personalizado" }));

    const calendar = await within(modal).findByRole("dialog", {
      name: "Elegir rango personalizado",
    });

    await expect(calendar).toBeVisible();
    await expect(
      within(calendar).getByRole("button", { name: "lunes, 5 de octubre de 2026" }),
    ).toBeEnabled();
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

/** Los ocho de siempre más los opcionales, con "Personalizado" al final. */
const EXTENDED_PRESETS: readonly AnyDateRangePreset[] = [
  ...DATE_RANGE_PRESETS.filter((preset) => preset !== "custom"),
  ...EXTENDED_DATE_RANGE_PRESETS,
  "custom",
];

function ExtendedDemo() {
  const [value, setValue] = useState<DateRangeValue<AnyDateRangePreset>>({ preset: "last_3_months" });

  return (
    <DateRangeField
      label="Periodo"
      maxDate={TODAY}
      onChange={setValue}
      presets={EXTENDED_PRESETS}
      today={TODAY}
      value={value}
    />
  );
}

/**
 * Presets opcionales (`EXTENDED_DATE_RANGE_PRESETS`): solo salen si se pasan en
 * `presets`. "Desde el inicio" no tiene fecha de inicio.
 */
export const PresetsExtendidos: Story = {
  name: "Presets extendidos",
  render: () => <ExtendedDemo />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("button", { name: "Últimos 3 meses" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByText("12 jul – 9 oct 2026")).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Últimos 14 días" }));
    await expect(canvas.getByText("26 sep – 9 oct 2026")).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Desde el inicio" }));
    await expect(canvas.getByRole("button", { name: "Desde el inicio" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByTestId("date-range-label")).toHaveTextContent("Desde el inicio");
  },
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
