import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { DashboardKpiTrend } from "./DashboardKpiTrend";

// REP-F2: la variación de los KPI se escribe igual que en Reportes y en el gráfico.
describe("DashboardKpiTrend", () => {
  it.each([
    [106.67, "↑ 106,7 %"],
    [-6.25, "↓ 6,3 %"],
    [-100, "↓ 100 %"],
    [0, "0 %"],
  ])("%p se muestra como %s", (changePercent, expected) => {
    render(<DashboardKpiTrend changePercent={changePercent} comparisonLabel="vs ayer" />);

    expect(screen.getByTestId("kpi-trend-delta")).toHaveTextContent(expected);
    expect(screen.getByText("vs ayer")).toBeInTheDocument();
  });

  it.each([null, undefined, NaN, Infinity])("%p no es comparable: texto neutro, nunca NaN", (changePercent) => {
    render(<DashboardKpiTrend changePercent={changePercent} neutralLabel="Sin datos de ayer" />);

    expect(screen.getByText("Sin datos de ayer")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/NaN|Infinity|%/);
  });
});
