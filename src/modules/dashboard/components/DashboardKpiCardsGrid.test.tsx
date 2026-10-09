import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { DashboardKpiCardsGrid } from "./DashboardKpiCardsGrid";

const summary = {
  activeCustomers: 4,
  dayOverDayChangePercent: null,
  lowStockCount: 2,
  pendingSalesCount: 0,
  previousDayTotalRef: 0,
  salesCount: 3,
  totalRef: 10,
  totalVes: 5000,
};

// REP-F2: los textos del dashboard van con tilde.
describe("DashboardKpiCardsGrid · textos", () => {
  it("hoy: «Ventas del día» y la alerta de stock con tildes", () => {
    render(<DashboardKpiCardsGrid preset="hoy" summary={summary} />);

    expect(screen.getByText("Ventas del día")).toBeInTheDocument();
    expect(screen.getByText("Crítico")).toBeInTheDocument();
    expect(screen.getByText("requiere acción")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\bdia\b|Critico|accion\b/);
  });

  it("otro periodo: «Clientes activos en catálogo»", () => {
    render(<DashboardKpiCardsGrid preset="rango" summary={summary} />);

    expect(screen.getByText("Clientes activos en catálogo")).toBeInTheDocument();
  });
});
