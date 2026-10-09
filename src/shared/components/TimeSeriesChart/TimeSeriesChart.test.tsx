/**
 * REP-01 · `TimeSeriesChart`: estados, línea y marcadores, picos, periodo
 * anterior, cambio REF / Bs y contenido del tooltip.
 *
 * jsdom no mide: como en `ProductKardexBalanceChart.test.tsx`, se simula un
 * contenedor de 390 × 280 (el ancho de móvil del plan) para que recharts dibuje.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

import { CHART_PREVIOUS_SERIES_STYLE } from "@/shared/components/charts/chartTheme";

import { buildRows, type TimeSeriesPoint, type TimeSeriesSeries } from "./chartData";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { TimeSeriesTooltip } from "./TimeSeriesTooltip";

function isoDay(offset: number) {
  return new Date(Date.UTC(2026, 9, 1 + offset, 12)).toISOString().slice(0, 10);
}

function makePoints(values: number[], startOffset = 0): TimeSeriesPoint[] {
  return values.map((valueRef, index) => ({
    count: index + 1,
    key: isoDay(startOffset + index),
    valueRef,
    valueVes: valueRef * 40,
  }));
}

const WEEK = [10, 50, 20, 80, 30, 40, 15];

/** Los 30 días de las stories `thirty-days` / `mobile` (2024-03-02 → 2024-03-31). */
const STORY_MONTH: TimeSeriesPoint[] = Array.from({ length: 30 }, (_, index) => {
  const weekly = [0.7, 0.85, 0.9, 1, 1.25, 1.6, 0.5][index % 7];
  const wave = 1 + Math.sin(index / 11) * 0.25;
  const jitter = ((index * 37) % 17) / 100;

  return {
    key: new Date(Date.UTC(2024, 2, 2 + index)).toISOString().slice(0, 10),
    valueRef: Math.round(180 * weekly * (wave + jitter) * 100) / 100,
  };
});

const SALES: TimeSeriesSeries = { id: "sales", name: "Ventas", points: makePoints(WEEK) };

const SALES_WITH_PREVIOUS: TimeSeriesSeries = {
  ...SALES,
  previousPoints: makePoints([5, 30, 25, 60, 20, 35, 10], -7),
};

function getChart() {
  return screen.getByRole("img");
}

async function waitForLines(count: number) {
  await waitFor(() =>
    expect(getChart().querySelectorAll(".recharts-line-curve")).toHaveLength(count),
  );
}

function peakKeys() {
  return [...getChart().querySelectorAll("[data-peak]")].map((node) =>
    node.getAttribute("data-peak"),
  );
}

function peakLabels() {
  return [...getChart().querySelectorAll("[data-peak] text")].map((node) => node.textContent);
}

describe("TimeSeriesChart", () => {
  const originalResizeObserver = global.ResizeObserver;
  let rectSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let containerWidth = 390;

  beforeEach(() => {
    containerWidth = 390;
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    // El contenedor mide 390 × 280. El span con el que recharts mide el texto de
    // los ticks mide lo que ocuparía ese texto: si midiera 390 px, recharts
    // quitaría todas las etiquetas del eje menos una.
    rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function measure(this: HTMLElement) {
        return (
          this.id === "recharts_measurement_span"
            ? { height: 13, width: (this.textContent ?? "").length * 6.6 }
            : { height: 280, width: containerWidth }
        ) as DOMRect;
      });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    rectSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  /** Ni NaN en atributos del SVG ni avisos de React / recharts en consola. */
  function expectCleanRender() {
    expect(getChart().innerHTML).not.toMatch(/NaN|Infinity/);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  }

  describe("estados", () => {
    it("cargando: esqueleto con rol status y sin gráfico", () => {
      render(<TimeSeriesChart ariaLabel="Ventas diarias" loading series={[SALES]} />);

      expect(screen.getByRole("status", { name: "Cargando Ventas diarias" })).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("error: mensaje y botón de reintentar que llama a onRetry", async () => {
      const onRetry = jest.fn();

      render(
        <TimeSeriesChart
          ariaLabel="Ventas diarias"
          error="No hay conexión con el servidor."
          onRetry={onRetry}
          series={[SALES]}
        />,
      );

      expect(screen.getByText("No se pudo cargar el gráfico")).toBeInTheDocument();
      expect(screen.getByText("No hay conexión con el servidor.")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("error sin onRetry: no ofrece reintentar", () => {
      render(<TimeSeriesChart ariaLabel="Ventas" error="Falló" series={[SALES]} />);

      expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    });

    it.each<[string, TimeSeriesSeries[]]>([
      ["sin series", []],
      ["serie sin puntos", [{ id: "sales", name: "Ventas", points: [] }]],
    ])("vacío (%s): texto del tema y sin gráfico", (_name, series) => {
      render(<TimeSeriesChart ariaLabel="Ventas diarias" series={series} />);

      expect(screen.getByText("Sin datos en este periodo")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Moneda del gráfico" })).not.toBeInTheDocument();
    });

    it("vacío con textos propios", () => {
      render(
        <TimeSeriesChart
          ariaLabel="Compras"
          emptyDescription="Registra una compra para verla aquí."
          emptyTitle="Aún no hay compras"
          series={[]}
        />,
      );

      expect(screen.getByText("Aún no hay compras")).toBeInTheDocument();
      expect(screen.getByText("Registra una compra para verla aquí.")).toBeInTheDocument();
    });
  });

  describe("línea, marcadores y picos", () => {
    it("dibuja una línea con un marcador por punto y role=img con resumen", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas diarias" series={[SALES]} />);
      await waitForLines(1);

      expect(getChart().querySelectorAll(".recharts-line-dot")).toHaveLength(WEEK.length);
      expect(getChart()).toHaveAccessibleName(
        "Ventas diarias: 7 puntos, del jueves, 1 de octubre de 2026 al miércoles, 7 de octubre de 2026. " +
          "Ventas: total ref 245.00, máximo ref 80.00 (domingo, 4 de octubre de 2026).",
      );
      expectCleanRender();
    });

    it("destaca por defecto los 3 picos más altos con su valor", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas diarias" series={[SALES]} />);
      await waitForLines(1);

      // Máximos locales: 50 (día 2), 80 (día 4), 40 (día 6).
      await waitFor(() => expect(peakLabels()).toEqual(["ref 50.00", "ref 80.00", "ref 40.00"]));
      expect(
        [...getChart().querySelectorAll("[data-peak]")].map((node) =>
          node.getAttribute("data-peak"),
        ),
      ).toEqual([isoDay(1), isoDay(3), isoDay(5)]);
    });

    it("el marcador de pico es mayor que el de un punto normal", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas diarias" series={[SALES]} />);
      await waitForLines(1);
      await waitFor(() => expect(getChart().querySelector("[data-peak] circle")).not.toBeNull());

      const peakRadius = Number(getChart().querySelector("[data-peak] circle")?.getAttribute("r"));
      const dotRadius = Number(getChart().querySelector(".recharts-line-dot")?.getAttribute("r"));

      expect(peakRadius).toBeGreaterThan(dotRadius);
    });

    it("peakCount limita los picos y 0 los apaga", async () => {
      const { rerender } = render(
        <TimeSeriesChart ariaLabel="Ventas" peakCount={1} series={[SALES]} />,
      );
      await waitForLines(1);
      await waitFor(() => expect(peakLabels()).toEqual(["ref 80.00"]));

      rerender(<TimeSeriesChart ariaLabel="Ventas" peakCount={0} series={[SALES]} />);

      await waitFor(() => expect(getChart().querySelector("[data-peak]")).toBeNull());
    });

    it("las etiquetas de pico quedan dentro del ancho del gráfico (390 px)", async () => {
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          series={[{ ...SALES, points: makePoints([900, 10, 20, 10, 20, 10, 950]) }]}
        />,
      );
      await waitForLines(1);
      await waitFor(() => expect(peakLabels().length).toBeGreaterThan(0));

      for (const text of getChart().querySelectorAll("[data-peak] text")) {
        const x = Number(text.getAttribute("x"));
        const width = (text.textContent ?? "").length * 11 * 0.6;

        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(390);
        expect(Number(text.getAttribute("y"))).toBeGreaterThan(0);
      }
    });

    // REP-F1: a 390 px el contenedor mide 326 (la tarjeta le quita 64 px).
    it.each([326, 1216])(
      "los picos son los mismos 3 máximos con un contenedor de %i px",
      async (width) => {
        containerWidth = width;
        render(
          <TimeSeriesChart
            ariaLabel="Ventas"
            series={[{ id: "sales", name: "Ventas", points: STORY_MONTH }]}
          />,
        );
        await waitForLines(1);

        await waitFor(() =>
          expect(peakKeys()).toEqual(["2024-03-07", "2024-03-21", "2024-03-28"]),
        );
      },
    );

    it("en móvil las etiquetas de pico no se pisan entre sí ni se salen del área", async () => {
      containerWidth = 326;
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          series={[{ id: "sales", name: "Ventas", points: STORY_MONTH }]}
        />,
      );
      await waitForLines(1);
      await waitFor(() => expect(peakKeys()).toHaveLength(3));

      const boxes = [...getChart().querySelectorAll("[data-peak] text")].map((text) => {
        const left = Number(text.getAttribute("x"));

        return { left, right: left + (text.textContent ?? "").length * 11 * 0.6 };
      });

      expect(boxes.length).toBeGreaterThan(0);
      boxes.forEach((box, index) => {
        expect(box.left).toBeGreaterThanOrEqual(52);
        expect(box.right).toBeLessThanOrEqual(326 - 12);
        if (index > 0) {
          expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1].right);
        }
      });
    });

    it("el último punto no es pico si es un punto bajo, aunque suba respecto al anterior", async () => {
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          series={[{ ...SALES, points: makePoints([10, 300, 20, 280, 40, 30, 90]) }]}
        />,
      );
      await waitForLines(1);

      await waitFor(() => expect(peakLabels()).toEqual(["ref 300.00", "ref 280.00"]));
    });

    it("un solo punto: se dibuja el punto, sin NaN", async () => {
      render(
        <TimeSeriesChart ariaLabel="Ventas" series={[{ ...SALES, points: makePoints([45]) }]} />,
      );

      await waitFor(() =>
        expect(getChart().querySelectorAll(".recharts-line-dot")).toHaveLength(1),
      );
      await waitFor(() => expect(peakLabels()).toEqual(["ref 45.00"]));
      expectCleanRender();
    });

    it("todos los valores en 0: eje estable 0–1, sin picos ni NaN", async () => {
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          series={[{ ...SALES, points: makePoints([0, 0, 0, 0]) }]}
        />,
      );
      await waitForLines(1);

      const yTicks = [
        ...getChart().querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"),
      ].map((node) => node.textContent);

      expect(yTicks).toEqual(["0", "1"]);
      expect(getChart().querySelector("[data-peak]")).toBeNull();
      expectCleanRender();
    });

    it("rango de 2 años: sin marcador por punto, solo los picos", async () => {
      const values = Array.from(
        { length: 730 },
        (_, index) => Math.round((Math.sin(index / 9) + 1.2) * 100 + (index % 7) * 5),
      );

      render(
        <TimeSeriesChart ariaLabel="Ventas" series={[{ ...SALES, points: makePoints(values) }]} />,
      );
      await waitForLines(1);
      await waitFor(() => expect(getChart().querySelectorAll("[data-peak]").length).toBe(3));

      expect(getChart().querySelectorAll(".recharts-line-dot")).toHaveLength(0);
      expectCleanRender();
    });

    it.each([30, 90])(
      "en 390 px las etiquetas del eje X no se solapan con %i puntos del mismo año",
      async (length) => {
        render(
          <TimeSeriesChart
            ariaLabel="Ventas"
            series={[
              { ...SALES, points: makePoints(Array.from({ length }, (_, index) => index + 1)) },
            ]}
          />,
        );
        await waitForLines(1);

        const ticks = [
          ...getChart().querySelectorAll(
            ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
          ),
        ];
        const centers = ticks.map((tick) => Number(tick.getAttribute("x")));

        expect(ticks.length).toBeGreaterThan(1);
        expect(ticks.length).toBeLessThan(length);
        expect(ticks[0].textContent).toBe("01/10");
        // Cada etiqueta «dd/mm» ocupa 5 × 6,6 px en la medición simulada.
        centers.slice(1).forEach((center, index) => {
          expect(center - centers[index]).toBeGreaterThanOrEqual(5 * 6.6);
        });
      },
    );

    it("rango que cruza de año: los ticks del eje X llevan año y no se solapan", async () => {
      // 730 días desde el 01/10/2026: llega a 2028.
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          series={[
            { ...SALES, points: makePoints(Array.from({ length: 730 }, (_, index) => index + 1)) },
          ]}
        />,
      );
      await waitForLines(1);

      const ticks = [
        ...getChart().querySelectorAll(
          ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
        ),
      ];
      const centers = ticks.map((tick) => Number(tick.getAttribute("x")));

      expect(ticks.length).toBeGreaterThan(1);
      expect(ticks[0].textContent).toBe("01/10/26");
      for (const tick of ticks) {
        expect(tick.textContent).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
      }
      // Cada etiqueta «dd/mm/aa» ocupa 8 × 6,6 px en la medición simulada.
      centers.slice(1).forEach((center, index) => {
        expect(center - centers[index]).toBeGreaterThanOrEqual(8 * 6.6);
      });
    });

    it("markerLimit decide cuándo se quitan los marcadores", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas" markerLimit={5} series={[SALES]} />);
      await waitForLines(1);

      expect(getChart().querySelectorAll(".recharts-line-dot")).toHaveLength(0);
    });
  });

  describe("periodo anterior", () => {
    it("lo dibuja discontinuo y atenuado, con su entrada en la leyenda", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas" series={[SALES_WITH_PREVIOUS]} />);
      await waitForLines(2);

      const previous = getChart().querySelector(".time-series-previous .recharts-line-curve");

      expect(previous).toHaveAttribute(
        "stroke-dasharray",
        CHART_PREVIOUS_SERIES_STYLE.strokeDasharray,
      );
      expect(previous).toHaveAttribute(
        "stroke-opacity",
        String(CHART_PREVIOUS_SERIES_STYLE.strokeOpacity),
      );
      expect(getChart().querySelectorAll(".time-series-previous .recharts-line-dot")).toHaveLength(
        0,
      );
      expect(screen.getByText("Periodo anterior")).toBeInTheDocument();
      expectCleanRender();
    });

    it("vacío: no se dibuja, no aparece en la leyenda y no rompe", async () => {
      render(
        <TimeSeriesChart ariaLabel="Ventas" series={[{ ...SALES, previousPoints: [] }]} />,
      );
      await waitForLines(1);

      expect(getChart().querySelector(".time-series-previous")).toBeNull();
      expect(screen.queryByText("Periodo anterior")).not.toBeInTheDocument();
      expectCleanRender();
    });

    it("no desplaza los picos de la serie actual aunque el anterior sea más alto", async () => {
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          series={[{ ...SALES, previousPoints: makePoints([500, 1, 600, 1, 700, 1, 800], -7) }]}
        />,
      );
      await waitForLines(2);

      await waitFor(() => expect(peakLabels()).toEqual(["ref 50.00", "ref 80.00", "ref 40.00"]));
    });
  });

  describe("REF / Bs", () => {
    it("arranca en REF y cambia el eje y las etiquetas a Bs", async () => {
      const onCurrencyChange = jest.fn();

      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          onCurrencyChange={onCurrencyChange}
          peakCount={1}
          series={[SALES]}
        />,
      );
      await waitForLines(1);

      const group = screen.getByRole("group", { name: "Moneda del gráfico" });
      const ref = within(group).getByRole("button", { name: "REF" });
      const ves = within(group).getByRole("button", { name: "Bs" });

      expect(ref).toHaveAttribute("aria-pressed", "true");
      expect(ves).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => expect(peakLabels()).toEqual(["ref 80.00"]));

      await userEvent.click(ves);

      expect(ves).toHaveAttribute("aria-pressed", "true");
      expect(ref).toHaveAttribute("aria-pressed", "false");
      expect(onCurrencyChange).toHaveBeenCalledTimes(1);
      expect(onCurrencyChange).toHaveBeenCalledWith("ves");
      await waitFor(() => expect(peakLabels()).toEqual(["Bs. 3.200,00"]));
      expect(getChart()).toHaveAccessibleName(expect.stringContaining("máximo Bs. 3.200,00"));

      await userEvent.click(ves);

      expect(onCurrencyChange).toHaveBeenCalledTimes(1);
    });

    it("se maneja con teclado", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas" series={[SALES]} />);
      await waitForLines(1);

      await userEvent.tab();
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");

      expect(screen.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
    });

    it("sin valores en Bs no hay control y se queda en REF", async () => {
      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          defaultCurrency="ves"
          peakCount={1}
          series={[
            {
              id: "sales",
              name: "Ventas",
              points: SALES.points.map(({ key, valueRef }) => ({ key, valueRef })),
            },
          ]}
        />,
      );
      await waitForLines(1);

      expect(screen.queryByRole("group", { name: "Moneda del gráfico" })).not.toBeInTheDocument();
      await waitFor(() => expect(peakLabels()).toEqual(["ref 80.00"]));
    });

    it("modo controlado: manda la prop currency", async () => {
      const onCurrencyChange = jest.fn();

      render(
        <TimeSeriesChart
          ariaLabel="Ventas"
          currency="ves"
          onCurrencyChange={onCurrencyChange}
          peakCount={1}
          series={[SALES]}
        />,
      );
      await waitForLines(1);
      await waitFor(() => expect(peakLabels()).toEqual(["Bs. 3.200,00"]));

      await userEvent.click(screen.getByRole("button", { name: "REF" }));

      expect(onCurrencyChange).toHaveBeenCalledWith("ref");
      expect(screen.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("varias series", () => {
    const five: TimeSeriesSeries[] = ["Efectivo", "Pago móvil", "Punto", "Zelle", "Crédito"].map(
      (name, index) => ({
        id: `m${index}`,
        name,
        points: makePoints(WEEK.map((value) => value + index * 10)),
      }),
    );

    it("5 series: 5 líneas de colores distintos, leyenda y picos sin etiqueta", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas por método" series={five} />);
      await waitForLines(5);

      const strokes = [...getChart().querySelectorAll(".recharts-line-curve")].map((node) =>
        node.getAttribute("stroke"),
      );

      expect(new Set(strokes).size).toBe(5);
      for (const stroke of strokes) {
        expect(stroke).toMatch(/^(var\(--[\w-]+\)|color-mix\(in srgb, var\()/);
      }
      for (const item of five) {
        expect(screen.getByText(item.name)).toBeInTheDocument();
      }
      await waitFor(() => expect(getChart().querySelectorAll("[data-peak]")).toHaveLength(15));
      expect(getChart().querySelectorAll("[data-peak] text")).toHaveLength(0);
      expectCleanRender();
    });

    it("ningún color literal en el SVG", async () => {
      render(<TimeSeriesChart ariaLabel="Ventas" series={[SALES_WITH_PREVIOUS]} />);
      await waitForLines(2);
      await waitFor(() => expect(peakLabels().length).toBe(3));

      const painted = [...getChart().querySelectorAll("[stroke], [fill]")].flatMap((node) => [
        node.getAttribute("stroke"),
        node.getAttribute("fill"),
      ]);

      for (const value of painted) {
        if (value !== null && value !== "none") {
          expect(value).not.toMatch(/^#|^rgb|^hsl/);
        }
      }
    });
  });

  it("ref entrega el contenedor role=img con el svg dentro, para exportarlo", async () => {
    const ref = createRef<HTMLDivElement>();

    render(<TimeSeriesChart ariaLabel="Ventas" ref={ref} series={[SALES]} />);
    await waitForLines(1);

    expect(ref.current).toBe(getChart());
    expect(ref.current?.querySelectorAll("svg.recharts-surface")).toHaveLength(1);
  });
});

describe("TimeSeriesTooltip", () => {
  const series = [{ color: "var(--primary)", id: "sales", name: "Ventas" }];
  const rows = buildRows([SALES_WITH_PREVIOUS]);

  it("muestra fecha en español, REF, Bs, nº de ventas y el periodo anterior", () => {
    render(<TimeSeriesTooltip countLabel="ventas" currency="ref" row={rows[3]} series={series} />);

    expect(screen.getByText("Domingo, 4 de octubre de 2026")).toBeInTheDocument();
    expect(screen.getByText("Ventas")).toBeInTheDocument();
    expect(screen.getByText("ref 80.00")).toBeInTheDocument();
    expect(screen.getByText("Bs. 3.200,00 · Ventas: 4")).toBeInTheDocument();
    expect(screen.getByText("Periodo anterior (27/09): ref 60.00")).toBeInTheDocument();
  });

  it("en Bs destaca el valor en Bs y deja REF en la línea secundaria", () => {
    render(<TimeSeriesTooltip countLabel="ventas" currency="ves" row={rows[3]} series={series} />);

    expect(screen.getByText("Bs. 3.200,00")).toBeInTheDocument();
    expect(screen.getByText("ref 80.00 · Ventas: 4")).toBeInTheDocument();
    expect(screen.getByText("Periodo anterior (27/09): Bs. 2.400,00")).toBeInTheDocument();
  });

  it("countLabel cambia la etiqueta del conteo", () => {
    render(<TimeSeriesTooltip countLabel="compras" currency="ref" row={rows[0]} series={series} />);

    expect(screen.getByText("Bs. 400,00 · Compras: 1")).toBeInTheDocument();
  });

  it("sin Bs, sin conteo y sin periodo anterior solo muestra lo que hay", () => {
    const [row] = buildRows([
      { id: "sales", name: "Ventas", points: [{ key: "2026-10-08", valueRef: 12.5 }] },
    ]);

    render(<TimeSeriesTooltip countLabel="ventas" currency="ref" row={row} series={series} />);

    expect(screen.getByText("ref 12.50")).toBeInTheDocument();
    expect(screen.queryByText(/Bs\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ventas:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Periodo anterior/)).not.toBeInTheDocument();
  });

  it("periodo anterior sin Bs: en modo Bs cae a su valor en REF", () => {
    const [row] = buildRows([
      {
        id: "sales",
        name: "Ventas",
        points: [{ key: "2026-10-08", valueRef: 10, valueVes: 400 }],
        previousPoints: [{ key: "2026-10-01", valueRef: 7 }],
      },
    ]);

    render(<TimeSeriesTooltip countLabel="ventas" currency="ves" row={row} series={series} />);

    expect(screen.getByText("Periodo anterior (01/10): ref 7.00")).toBeInTheDocument();
  });

  it("una fila de varias series lista cada una y omite la que no tiene punto", () => {
    const multiRows = buildRows([
      SALES,
      { id: "purchases", name: "Compras", points: [{ key: isoDay(1), valueRef: 33 }] },
    ]);
    const multi = [...series, { color: "var(--secondary-stitch)", id: "purchases", name: "Compras" }];

    const { rerender } = render(
      <TimeSeriesTooltip countLabel="ventas" currency="ref" row={multiRows[1]} series={multi} />,
    );

    expect(screen.getByText("Compras")).toBeInTheDocument();
    expect(screen.getByText("ref 33.00")).toBeInTheDocument();

    rerender(
      <TimeSeriesTooltip countLabel="ventas" currency="ref" row={multiRows[0]} series={multi} />,
    );

    expect(screen.queryByText("Compras")).not.toBeInTheDocument();
  });
});
