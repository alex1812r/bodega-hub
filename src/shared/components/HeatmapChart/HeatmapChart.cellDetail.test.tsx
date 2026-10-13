/**
 * REP-F6 · el valor exacto de una celda solo estaba en `title` y en texto
 * `sr-only`: inalcanzable con el dedo y con el teclado. Ahora cada celda es un
 * botón (un solo alto de tabulación, flechas para moverse) y al enfocarla o
 * tocarla su valor se escribe en una zona visible bajo el mapa.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HeatmapChart } from "./HeatmapChart";

const ROWS = [
  { id: "1", label: "Lun", name: "lunes" },
  { id: "2", label: "Mar", name: "martes" },
];
const COLUMNS = [
  { id: "8", label: "8", name: "08:00" },
  { id: "9", label: "9", name: "09:00" },
  { id: "10", label: "10", name: "10:00" },
];
const VALUES = [
  [0, 50, 100],
  [10, 0, 60],
];

function renderChart() {
  render(<HeatmapChart ariaLabel="Ventas por hora" columns={COLUMNS} rows={ROWS} values={VALUES} />);
}

function detail() {
  return screen.getByTestId("heatmap-cell-detail");
}

describe("HeatmapChart · valor de la celda con dedo y teclado", () => {
  it("la zona del valor es visible, anuncia con cortesía y de entrada explica cómo usarla", () => {
    renderChart();

    expect(detail()).toHaveAttribute("aria-live", "polite");
    expect(detail()).not.toHaveClass("sr-only");
    expect(detail()).toHaveTextContent("Toca una celda o muévete con las flechas para ver su valor.");
  });

  it("tocar una celda muestra su valor exacto bajo el mapa", async () => {
    renderChart();

    await userEvent.click(screen.getByRole("button", { name: "lunes, 10:00: ref 100.00" }));

    expect(detail()).toHaveTextContent("lunes, 10:00: ref 100.00");
  });

  it("las celdas ocupan un solo alto de tabulación y enfocar una muestra su valor", async () => {
    renderChart();

    const cells = screen.getAllByRole("button");

    expect(cells).toHaveLength(6);
    expect(cells.map((cell) => cell.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);

    await userEvent.tab();

    expect(cells[0]).toHaveFocus();
    expect(detail()).toHaveTextContent("lunes, 08:00: ref 0.00");

    await userEvent.tab();

    expect(cells.some((cell) => cell === document.activeElement)).toBe(false);
  });

  it("las flechas, Inicio y Fin mueven el foco por la cuadrícula sin salirse", async () => {
    renderChart();
    await userEvent.tab();

    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("button", { name: "lunes, 10:00: ref 100.00" })).toHaveFocus();
    expect(detail()).toHaveTextContent("lunes, 10:00: ref 100.00");

    await userEvent.keyboard("{ArrowRight}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("button", { name: "martes, 10:00: ref 60.00" })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "martes, 08:00: ref 10.00" })).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}{ArrowUp}{ArrowUp}{End}");
    expect(screen.getByRole("button", { name: "lunes, 10:00: ref 100.00" })).toHaveFocus();

    // La celda activa es la que conserva el alto de tabulación.
    expect(screen.getAllByRole("button").map((cell) => cell.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1]);
  });

  it("describeCell también es el texto de la zona visible", async () => {
    render(
      <HeatmapChart
        ariaLabel="Ventas por hora"
        columns={COLUMNS}
        describeCell={({ column, row, value }) => `f${row} c${column} = ${value}`}
        rows={ROWS}
        values={VALUES}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "f1 c2 = 60" }));

    expect(detail()).toHaveTextContent("f1 c2 = 60");
  });
});
