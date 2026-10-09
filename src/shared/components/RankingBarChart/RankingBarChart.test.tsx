/**
 * REP-04 · `RankingBarChart`: orden, top N, etiquetas recortadas, comparación
 * con el periodo anterior, estados y ausencia de NaN.
 *
 * En jest `formatRef` devuelve `ref 120.00`. jsdom no mide: sin `ResizeObserver`
 * el gráfico se dibuja con su ancho de reserva (320 px); para probar 390 px y
 * anchos mayores se simula el observador.
 */
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

import { RankingBarChart } from "./RankingBarChart";
import type { RankingBarItem } from "./rankingData";

const PRODUCTS: RankingBarItem[] = [
  { id: "p1", label: "Arroz", value: 40 },
  { id: "p2", label: "Harina de maíz precocida blanca extra fina 1 kg (paquete de 20 unidades)", value: 120 },
  { id: "p3", label: "Café", value: 75.5 },
];

function getChart() {
  return screen.getByRole("img");
}

function rows() {
  return [...getChart().querySelectorAll("g[data-rank]")];
}

function barWidths(kind: "current" | "previous" = "current") {
  return [...getChart().querySelectorAll(`rect[data-bar="${kind}"]`)].map((bar) =>
    Number(bar.getAttribute("width")),
  );
}

function valueTexts() {
  return [...getChart().querySelectorAll("text[data-value]")].map((node) => node.textContent);
}

function expectNoNaN() {
  expect(getChart().outerHTML).not.toMatch(/NaN|Infinity|undefined/);
}

describe("RankingBarChart", () => {
  const originalResizeObserver = global.ResizeObserver;
  let resize: ((width: number) => void) | null = null;

  function mockResizeObserver() {
    global.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      disconnect() {}
      observe() {
        resize = (width: number) =>
          this.callback(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      unobserve() {}
    };
  }

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    resize = null;
  });

  it("ordena las barras de mayor a menor con el valor al final de cada una", () => {
    render(<RankingBarChart ariaLabel="Top productos" items={PRODUCTS} />);

    expect(valueTexts()).toEqual(["ref 120.00", "ref 75.50", "ref 40.00"]);
    const widths = barWidths();
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expectNoNaN();
  });

  it("dibuja como máximo topN elementos; por defecto 10", () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      id: `p${index}`,
      label: `Producto ${index}`,
      value: index + 1,
    }));
    const { rerender } = render(<RankingBarChart ariaLabel="Top productos" items={many} />);

    expect(rows()).toHaveLength(10);

    rerender(<RankingBarChart ariaLabel="Top productos" items={many} topN={3} />);

    expect(valueTexts()).toEqual(["ref 14.00", "ref 13.00", "ref 12.00"]);
  });

  it("recorta las etiquetas largas y deja el nombre completo en el título y en el resumen", () => {
    render(<RankingBarChart ariaLabel="Top productos" items={PRODUCTS} />);

    const label = rows()[0].querySelector("text");
    const full = `1. ${PRODUCTS[1].label}`;

    expect(label?.querySelector("title")).toHaveTextContent(full);
    expect(label?.lastChild?.textContent).toMatch(/…$/);
    expect(label?.lastChild?.textContent?.length).toBeLessThan(full.length);
    expect(getChart()).toHaveAccessibleName(expect.stringContaining(full));
  });

  it("a 390 px ninguna etiqueta ni valor se sale del ancho; con más ancho caben más caracteres", () => {
    mockResizeObserver();
    render(<RankingBarChart ariaLabel="Top productos" items={PRODUCTS} />);

    act(() => resize?.(326));

    const svg = getChart().querySelector("svg.ranking-bar-chart-surface");
    expect(svg).toHaveAttribute("viewBox", expect.stringMatching(/^0 0 326 /));

    const narrowLabel = rows()[0].querySelector("text")?.lastChild?.textContent ?? "";
    expect(narrowLabel.length * 12 * 0.6).toBeLessThanOrEqual(326);

    for (const row of rows()) {
      const bar = row.querySelector('rect[data-bar="current"]');
      const value = row.querySelector("text[data-value]");
      const end =
        Number(value?.getAttribute("x")) + (value?.textContent?.length ?? 0) * 11 * 0.6;

      expect(Number(bar?.getAttribute("x")) + Number(bar?.getAttribute("width"))).toBeLessThanOrEqual(326);
      expect(end).toBeLessThanOrEqual(326);
    }

    act(() => resize?.(900));

    expect(rows()[0].querySelector("text")?.lastChild?.textContent).toBe(`1. ${PRODUCTS[1].label}`);
    expectNoNaN();
  });

  it("una sola fila: una barra a todo el ancho, sin NaN", () => {
    render(
      <RankingBarChart ariaLabel="Top clientes" items={[{ id: "c1", label: "Ana", value: 50 }]} />,
    );

    expect(rows()).toHaveLength(1);
    expect(barWidths()[0]).toBeGreaterThan(0);
    expect(getChart()).toHaveAccessibleName("Top clientes: 1 elemento. 1. Ana: ref 50.00.");
    expectNoNaN();
  });

  it("todo en 0: filas con barras sin ancho, sin NaN", () => {
    render(
      <RankingBarChart
        ariaLabel="Top clientes"
        items={[
          { id: "c1", label: "Ana", value: 0 },
          { id: "c2", label: "Luis", value: 0 },
        ]}
      />,
    );

    expect(barWidths()).toEqual([0, 0]);
    expect(valueTexts()).toEqual(["ref 0.00", "ref 0.00"]);
    expectNoNaN();
  });

  it("valores negativos: línea de cero y barra hacia la izquierda", () => {
    render(
      <RankingBarChart
        ariaLabel="Rentabilidad"
        items={[
          { id: "a", label: "Gana", value: 90 },
          { id: "b", label: "Pierde", value: -30 },
        ]}
      />,
    );

    const zero = Number(getChart().querySelector("line")?.getAttribute("x1"));
    const [gain, loss] = [...getChart().querySelectorAll('rect[data-bar="current"]')];

    expect(zero).toBeGreaterThan(0);
    expect(Number(gain.getAttribute("x"))).toBeCloseTo(zero);
    expect(Number(loss.getAttribute("x")) + Number(loss.getAttribute("width"))).toBeCloseTo(zero);
    expect(valueTexts()).toEqual(["ref 90.00", "ref -30.00"]);
    expectNoNaN();
  });

  it("con periodo anterior dibuja su barra y «Antes … · variación»; sin dato, una raya", () => {
    render(
      <RankingBarChart
        ariaLabel="Métodos de pago"
        items={[
          { deltaPct: 20, id: "cash", label: "Efectivo", previousValue: 100, value: 120 },
          { deltaPct: null, id: "zelle", label: "Zelle", previousValue: 0, value: 30 },
          { deltaPct: null, id: "pm", label: "Pago móvil", previousValue: null, value: 10 },
        ]}
      />,
    );

    const comparisons = [...getChart().querySelectorAll("text[data-comparison]")].map(
      (node) => node.textContent,
    );

    expect(comparisons).toEqual([
      "Antes ref 100.00 · ↑ 20 %",
      "Antes ref 0.00 · —",
      "Antes — · —",
    ]);
    expect(getChart().querySelectorAll('rect[data-bar="previous"]')).toHaveLength(2);
    expectNoNaN();
  });

  it("usa formatValue para el valor", () => {
    render(
      <RankingBarChart
        ariaLabel="Top productos"
        formatValue={(value) => `${value} uds`}
        items={PRODUCTS}
      />,
    );

    expect(valueTexts()).toEqual(["120 uds", "75.5 uds", "40 uds"]);
  });

  it("solo usa colores del tema", () => {
    render(<RankingBarChart ariaLabel="Top productos" items={PRODUCTS} />);

    expect(getChart().outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    expect(getChart().querySelector('rect[data-bar="current"]')).toHaveAttribute(
      "fill",
      "var(--chart-1)",
    );
  });

  it("entrega el contenedor por ref para exportar el svg", () => {
    const ref = createRef<HTMLDivElement>();

    render(<RankingBarChart ariaLabel="Top productos" items={PRODUCTS} ref={ref} />);

    expect(ref.current).toBe(getChart());
    expect(ref.current?.querySelectorAll("svg.ranking-bar-chart-surface")).toHaveLength(1);
  });

  describe("estados", () => {
    it("cargando: esqueleto con rol status y sin gráfico", () => {
      render(<RankingBarChart ariaLabel="Top productos" items={PRODUCTS} loading />);

      expect(screen.getByRole("status", { name: "Cargando Top productos" })).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("error: mensaje y botón de reintentar", async () => {
      const onRetry = jest.fn();

      render(
        <RankingBarChart ariaLabel="Top productos" error="Sin conexión" items={[]} onRetry={onRetry} />,
      );

      expect(screen.getByText("No se pudo cargar el gráfico")).toBeInTheDocument();
      expect(screen.getByText("Sin conexión")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("vacío: título y descripción configurables, sin gráfico", () => {
      render(
        <RankingBarChart
          ariaLabel="Top productos"
          emptyDescription="No hubo ventas."
          emptyTitle="Sin ventas"
          items={[]}
        />,
      );

      expect(screen.getByText("Sin ventas")).toBeInTheDocument();
      expect(screen.getByText("No hubo ventas.")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });
});
