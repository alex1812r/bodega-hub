import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Modal } from "@/shared/components/Modal";

import { DateRangeField, type DateRangeFieldProps } from "./DateRangeField";
import type { DateRangeChange, DateRangeValue } from "./dateRangePresets";

const TODAY = "2026-10-09";

type HarnessProps = Partial<Omit<DateRangeFieldProps, "onChange" | "value">> & {
  initialValue?: DateRangeValue;
  onChange?: (next: DateRangeChange) => void;
};

function Harness({ initialValue = {}, onChange, ...props }: HarnessProps) {
  const [value, setValue] = useState<DateRangeValue>(initialValue);

  return (
    <DateRangeField
      today={TODAY}
      {...props}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      value={value}
    />
  );
}

function renderField(props: HarnessProps = {}) {
  const onChange = jest.fn<void, [DateRangeChange]>();

  render(<Harness onChange={onChange} {...props} />);

  return { onChange, user: userEvent.setup() };
}

function chip(name: string) {
  return screen.getByRole("button", { name });
}

function day(name: RegExp | string) {
  return screen.getByRole("button", { name });
}

describe("DateRangeField", () => {
  it("muestra los ocho presets y ningún input nativo de fecha", async () => {
    const { user } = renderField();

    expect(
      within(screen.getByRole("group", { name: "Rango de fechas" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "Hoy",
      "Ayer",
      "Esta semana",
      "Semana pasada",
      "Este mes",
      "Mes pasado",
      "Últimos 30 días",
      "Personalizado",
    ]);
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("Todas las fechas");

    await user.click(chip("Personalizado"));

    expect(screen.getByRole("dialog", { name: "Elegir rango personalizado" })).toBeInTheDocument();
    expect(document.querySelector("input")).toBeNull();
    expect(
      document.querySelector('[type="date"], [type="datetime-local"], [type="month"]'),
    ).toBeNull();
  });

  it("un clic en Mes pasado emite una sola vez el rango calculado", async () => {
    const { onChange, user } = renderField();

    await user.click(chip("Mes pasado"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      from: "2026-09-01",
      preset: "last_month",
      to: "2026-09-30",
    });
    expect(chip("Mes pasado")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Hoy")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("1–30 sep 2026");
  });

  it("calcula los presets con el hoy inyectado", async () => {
    const { onChange, user } = renderField({ today: "2026-01-01" });

    await user.click(chip("Esta semana"));
    await user.click(chip("Ayer"));

    expect(onChange).toHaveBeenNthCalledWith(1, {
      from: "2025-12-29",
      preset: "this_week",
      to: "2026-01-01",
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      from: "2025-12-31",
      preset: "yesterday",
      to: "2025-12-31",
    });
  });

  it("resuelve con hoy un valor que solo trae preset", () => {
    renderField({ initialValue: { preset: "this_month" } });

    expect(chip("Este mes")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("1–9 oct 2026");
  });

  it("marca el chip que corresponde a unas fechas sin preset, o Personalizado", () => {
    const { rerender } = render(
      <DateRangeField
        onChange={jest.fn()}
        today={TODAY}
        value={{ from: "2026-09-01", to: "2026-09-30" }}
      />,
    );

    expect(chip("Mes pasado")).toHaveAttribute("aria-pressed", "true");

    rerender(
      <DateRangeField
        onChange={jest.fn()}
        today={TODAY}
        value={{ from: "2026-09-02", to: "2026-09-30" }}
      />,
    );

    expect(chip("Mes pasado")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Personalizado")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("2–30 sep 2026");
  });

  it("elige un rango en el calendario con dos clics", async () => {
    const { onChange, user } = renderField();

    await user.click(chip("Personalizado"));

    expect(chip("Personalizado")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table", { name: "octubre de 2026" })).toBeInTheDocument();
    expect(day("viernes, 9 de octubre de 2026, hoy")).toHaveAttribute("aria-current", "date");

    await user.click(day("lunes, 5 de octubre de 2026"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Elige el día de fin.")).toBeInTheDocument();

    await user.click(day("miércoles, 7 de octubre de 2026"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-05", preset: "custom", to: "2026-10-07" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip("Personalizado")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Personalizado")).toHaveFocus();
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("5–7 oct 2026");
  });

  it("intercambia los extremos si el fin es anterior al inicio", async () => {
    const { onChange, user } = renderField();

    await user.click(chip("Personalizado"));
    await user.click(day("miércoles, 7 de octubre de 2026"));
    await user.click(day("jueves, 1 de octubre de 2026"));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-01", preset: "custom", to: "2026-10-07" });
  });

  it("resalta el rango elegido al reabrir el calendario", async () => {
    const { user } = renderField({ initialValue: { from: "2026-10-05", to: "2026-10-07" } });

    await user.click(chip("Personalizado"));

    expect(day("lunes, 5 de octubre de 2026")).toHaveAttribute("aria-pressed", "true");
    expect(day("miércoles, 7 de octubre de 2026")).toHaveAttribute("aria-pressed", "true");
    expect(day("martes, 6 de octubre de 2026")).toHaveAttribute("data-in-range", "true");
    expect(day("jueves, 8 de octubre de 2026")).not.toHaveAttribute("data-in-range");
  });

  it("con un rango entre dos meses abre en el mes del fin, con el foco en ese día (REP-F1)", async () => {
    const { user } = renderField({
      initialValue: { from: "2026-09-28", preset: "custom", to: "2026-10-06" },
      maxDate: TODAY,
    });

    await user.click(chip("Personalizado"));

    expect(screen.getByRole("table", { name: "octubre de 2026" })).toBeInTheDocument();
    expect(day("martes, 6 de octubre de 2026")).toHaveFocus();
    expect(day("sábado, 10 de octubre de 2026")).toBeDisabled();
  });

  it("con solo el inicio del rango abre en ese mes", async () => {
    const { user } = renderField({ initialValue: { from: "2026-09-28" } });

    await user.click(chip("Personalizado"));

    expect(screen.getByRole("table", { name: "septiembre de 2026" })).toBeInTheDocument();
  });

  describe("altura disponible (REP-F1)", () => {
    const originalInnerHeight = window.innerHeight;
    let rectSpy: jest.SpyInstance;

    /** Chip en y=100–130 y un calendario que mide 366 px de alto sin límite. */
    function mockLayout(viewportHeight: number) {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: viewportHeight });
      rectSpy = jest
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function measure(this: HTMLElement) {
          if (this.getAttribute("role") === "dialog") {
            const limit = parseFloat(this.style.maxHeight);
            const top = parseFloat(this.style.top) || 0;
            const height = Number.isNaN(limit) ? 366 : Math.min(366, limit);

            return { bottom: top + height, height, left: 0, right: 320, top, width: 320 } as DOMRect;
          }

          return { bottom: 130, height: 30, left: 16, right: 140, top: 100, width: 124 } as DOMRect;
        });
    }

    afterEach(() => {
      rectSpy.mockRestore();
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    });

    it("en un viewport bajo (844×390) limita el alto al hueco y deja scroll interno", async () => {
      mockLayout(390);
      const { user } = renderField();

      await user.click(chip("Personalizado"));

      const popover = screen.getByRole("dialog", { name: "Elegir rango personalizado" });

      // Debajo del chip (134) hasta el margen inferior (390 − 8).
      expect(popover.style.top).toBe("134px");
      expect(popover.style.maxHeight).toBe("248px");
      expect(popover).toHaveClass("overflow-y-auto");
      expect(popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(390);
    });

    it("si cabe entero no limita el alto", async () => {
      mockLayout(844);
      const { user } = renderField();

      await user.click(chip("Personalizado"));

      const popover = screen.getByRole("dialog", { name: "Elegir rango personalizado" });

      expect(popover.style.top).toBe("134px");
      expect(popover.style.maxHeight).toBe("");
    });

    it("si solo cabe entero arriba, se coloca arriba sin limitar el alto", async () => {
      mockLayout(390);
      rectSpy.mockImplementation(function measure(this: HTMLElement) {
        if (this.getAttribute("role") === "dialog") {
          const top = parseFloat(this.style.top) || 0;

          return { bottom: top + 200, height: 200, left: 0, right: 320, top, width: 320 } as DOMRect;
        }

        return { bottom: 330, height: 30, left: 16, right: 140, top: 300, width: 124 } as DOMRect;
      });
      const { user } = renderField();

      await user.click(chip("Personalizado"));

      const popover = screen.getByRole("dialog", { name: "Elegir rango personalizado" });

      expect(popover.style.top).toBe("96px");
      expect(popover.style.maxHeight).toBe("");
    });
  });

  it("dentro de un Modal: el calendario vive en el diálogo, se opera y no lo cierra (REP-F1)", async () => {
    const onChange = jest.fn<void, [DateRangeChange]>();
    const user = userEvent.setup();

    render(
      <Modal open title="Filtros del reporte">
        <Harness onChange={onChange} />
      </Modal>,
    );

    const modal = screen.getByRole("dialog", { name: "Filtros del reporte" });

    await user.click(within(modal).getByRole("button", { name: "Personalizado" }));

    const calendar = within(modal).getByRole("dialog", { name: "Elegir rango personalizado" });

    await user.click(within(calendar).getByRole("button", { name: "lunes, 5 de octubre de 2026" }));
    await user.click(
      within(calendar).getByRole("button", { name: "miércoles, 7 de octubre de 2026" }),
    );

    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-05", preset: "custom", to: "2026-10-07" });
    expect(screen.getByRole("dialog", { name: "Filtros del reporte" })).toBeInTheDocument();
    expect(within(modal).getByTestId("date-range-label")).toHaveTextContent("5–7 oct 2026");

    await user.click(within(modal).getByRole("button", { name: "Personalizado" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Elegir rango personalizado" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Filtros del reporte" })).toBeInTheDocument();
  });

  it("navega al mes anterior y al siguiente", async () => {
    const { onChange, user } = renderField();

    await user.click(chip("Personalizado"));
    await user.click(screen.getByRole("button", { name: "Mes anterior" }));

    expect(screen.getByRole("table", { name: "septiembre de 2026" })).toBeInTheDocument();

    await user.click(day("martes, 1 de septiembre de 2026"));
    await user.click(screen.getByRole("button", { name: "Mes siguiente" }));
    await user.click(day("viernes, 2 de octubre de 2026"));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-09-01", preset: "custom", to: "2026-10-02" });
  });

  it("se maneja con el teclado: flechas, Enter y cambio de mes", async () => {
    const { onChange, user } = renderField();

    chip("Personalizado").focus();
    await user.keyboard("{Enter}");

    expect(day("viernes, 9 de octubre de 2026, hoy")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(day("jueves, 8 de octubre de 2026")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard("{ArrowUp}");
    expect(day("jueves, 1 de octubre de 2026")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("table", { name: "septiembre de 2026" })).toBeInTheDocument();
    expect(day("jueves, 24 de septiembre de 2026")).toHaveFocus();

    await user.keyboard("{ArrowRight}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-02", preset: "custom", to: "2026-10-08" });
    expect(chip("Personalizado")).toHaveFocus();
  });

  it("Escape cierra el calendario sin emitir y devuelve el foco al chip", async () => {
    const { onChange, user } = renderField();

    await user.click(chip("Personalizado"));
    await user.click(day("lunes, 5 de octubre de 2026"));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(chip("Personalizado")).toHaveFocus();
    expect(chip("Personalizado")).toHaveAttribute("aria-expanded", "false");
  });

  it("un clic fuera cierra el calendario", async () => {
    const { user } = renderField();

    await user.click(chip("Personalizado"));
    await user.click(document.body);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con maxDate deshabilita los días futuros y no deja pasar de ese día", async () => {
    const { onChange, user } = renderField({ maxDate: TODAY });

    await user.click(chip("Personalizado"));

    expect(day("sábado, 10 de octubre de 2026")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeDisabled();

    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(day("viernes, 9 de octubre de 2026, hoy")).toHaveFocus();

    await user.click(day("sábado, 10 de octubre de 2026"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("con minDate deshabilita los días anteriores", async () => {
    const { user } = renderField({ minDate: "2026-10-05" });

    await user.click(chip("Personalizado"));

    expect(day("domingo, 4 de octubre de 2026")).toBeDisabled();
    expect(day("lunes, 5 de octubre de 2026")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeDisabled();
  });

  it("con clearable deja el campo sin rango", async () => {
    const { onChange, user } = renderField({
      clearable: true,
      initialValue: { preset: "today" },
    });

    await user.click(screen.getByRole("button", { name: "Quitar rango de fechas" }));

    expect(onChange).toHaveBeenCalledWith({ from: undefined, preset: undefined, to: undefined });
    expect(screen.queryByRole("button", { name: "Quitar rango de fechas" })).not.toBeInTheDocument();
    expect(chip("Hoy")).toHaveAttribute("aria-pressed", "false");
  });

  it("sin clearable no ofrece quitar el rango", () => {
    renderField({ initialValue: { preset: "today" } });

    expect(screen.queryByRole("button", { name: "Quitar rango de fechas" })).not.toBeInTheDocument();
  });

  it("muestra solo los presets pedidos, en ese orden", () => {
    renderField({ label: "Periodo", presets: ["last_month", "today"] });

    expect(
      within(screen.getByRole("group", { name: "Periodo" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Mes pasado", "Hoy"]);
  });

  it("deshabilitado no emite ni abre el calendario", async () => {
    const { onChange, user } = renderField({ clearable: true, disabled: true, initialValue: { preset: "today" } });

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }

    await user.click(chip("Mes pasado"));
    await user.click(chip("Personalizado"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("elegir un preset con el calendario abierto lo cierra", async () => {
    const { onChange, user } = renderField();

    await user.click(chip("Personalizado"));
    await user.click(chip("Hoy"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ from: TODAY, preset: "today", to: TODAY });
  });
});
