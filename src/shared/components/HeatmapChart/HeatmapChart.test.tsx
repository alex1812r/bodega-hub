/**
 * REP-06b · `HeatmapChart`: intensidad por nivel, valor exacto en cada celda,
 * leyenda, estados y ausencia de NaN (también con todo en 0).
 *
 * En jest `formatRef` devuelve `ref 120.00`.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
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

function levels() {
  return [...screen.getByRole("table").querySelectorAll("td[data-heat-cell]")].map((cell) =>
    Number(cell.getAttribute("data-heat-cell")),
  );
}

describe("HeatmapChart", () => {
  it("pinta una celda por fila y columna con su nivel de intensidad", () => {
    render(<HeatmapChart ariaLabel="Ventas por hora" columns={COLUMNS} rows={ROWS} values={VALUES} />);

    expect(screen.getByRole("table", { name: "Ventas por hora" })).toBeInTheDocument();
    expect(levels()).toEqual([0, 3, 5, 1, 0, 3]);
    expect(screen.getByRole("rowheader", { name: /lunes/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /10:00/ })).toBeInTheDocument();
  });

  it("cada celda lleva su valor exacto en title y en texto para lector de pantalla", () => {
    render(<HeatmapChart ariaLabel="Ventas por hora" columns={COLUMNS} rows={ROWS} values={VALUES} />);

    const cell = screen.getByTitle("lunes, 10:00: ref 100.00");

    expect(cell).toHaveTextContent("lunes, 10:00: ref 100.00");
    expect(screen.getByTitle("martes, 09:00: ref 0.00")).toHaveAttribute("data-heat-cell", "0");
  });

  it("describeCell sustituye el texto de la celda", () => {
    render(
      <HeatmapChart
        ariaLabel="Ventas por hora"
        columns={COLUMNS}
        describeCell={({ column, row, value }) => `f${row} c${column} = ${value}`}
        rows={ROWS}
        values={VALUES}
      />,
    );

    expect(screen.getByTitle("f1 c2 = 60")).toBeInTheDocument();
  });

  it("usa un solo tono del tema, sin colores literales", () => {
    render(<HeatmapChart ariaLabel="Ventas por hora" columns={COLUMNS} rows={ROWS} values={VALUES} />);

    const swatches = [...document.querySelectorAll<HTMLElement>("[data-heat-level]")];

    expect(new Set(swatches.map((node) => node.style.backgroundColor))).toEqual(new Set(["var(--chart-1)"]));
    expect(document.body.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|color-mix/i);
  });

  it("la leyenda explica la escala y el máximo", () => {
    render(
      <HeatmapChart
        ariaLabel="Ventas por hora"
        columns={COLUMNS}
        measureLabel="REF vendido"
        rows={ROWS}
        values={VALUES}
      />,
    );

    const legend = within(screen.getByTestId("heatmap-legend"));

    expect(legend.getByText("Menos")).toBeInTheDocument();
    expect(legend.getByText("Más")).toBeInTheDocument();
    expect(legend.getByText("REF vendido · máximo ref 100.00")).toBeInTheDocument();
  });

  it("rotula una de cada N columnas sin perder el nombre accesible del resto", () => {
    render(
      <HeatmapChart
        ariaLabel="Ventas por hora"
        columnLabelEvery={2}
        columns={COLUMNS}
        rows={ROWS}
        values={VALUES}
      />,
    );

    const headers = screen.getAllByRole("columnheader");

    expect(headers.map((header) => header.querySelector("[aria-hidden]")?.textContent ?? "")).toEqual([
      "8",
      "",
      "10",
    ]);
    expect(screen.getByRole("columnheader", { name: /09:00/ })).toBeInTheDocument();
  });

  it("todo en 0, huecos y valores no numéricos: celdas sin nivel y ningún NaN", () => {
    render(
      <HeatmapChart
        ariaLabel="Ventas por hora"
        columns={COLUMNS}
        rows={ROWS}
        values={[[0, 0, Number.NaN], [0]]}
      />,
    );

    expect(levels()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(screen.getByTestId("heatmap-legend")).toHaveTextContent("sin valores");
    expect(document.body.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
  });

  describe("estados", () => {
    it("cargando: esqueleto con rol status y sin tabla", () => {
      render(<HeatmapChart ariaLabel="Ventas por hora" columns={COLUMNS} loading rows={ROWS} values={VALUES} />);

      expect(screen.getByRole("status", { name: "Cargando Ventas por hora" })).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("error: mensaje y botón de reintentar", async () => {
      const onRetry = jest.fn();

      render(
        <HeatmapChart
          ariaLabel="Ventas por hora"
          columns={COLUMNS}
          error="Sin conexión"
          onRetry={onRetry}
          rows={ROWS}
          values={VALUES}
        />,
      );

      expect(screen.getByText("Sin conexión")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("vacío: sin filas o sin columnas", () => {
      render(
        <HeatmapChart ariaLabel="Ventas por hora" columns={COLUMNS} emptyTitle="Sin ventas" rows={[]} values={[]} />,
      );

      expect(screen.getByText("Sin ventas")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });
});
