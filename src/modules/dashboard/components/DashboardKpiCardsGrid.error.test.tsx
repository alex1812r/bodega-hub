/**
 * REP-F10 · indicadores del dashboard cuando una consulta falla:
 * - N-04: si falla `/api/dashboard/metrics` las tarjetas pintaban
 *   «ref 0.00 · 0 ventas» como si fueran datos. Ahora «—», el error del tema y
 *   «Reintentar».
 * - N-12: si falla `/api/dashboard/summary` el error se queda en las tarjetas
 *   que dependen del resumen; las de ventas siguen con sus cifras.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { DashboardKpiCardsGrid } from "./DashboardKpiCardsGrid";

const summary = {
  activeCustomers: 4,
  dayOverDayChangePercent: null,
  lowStockCount: 2,
  pendingSalesCount: 0,
  previousDayTotalRef: 0,
  salesCount: 3,
  totalRef: 37.5,
  totalVes: 19500,
};

const metrics = {
  from: "2026-05-18",
  paidVes: 19500,
  pendingVes: 0,
  salesCount: 2,
  to: "2026-05-18",
  totalRef: 37.5,
  totalVes: 19500,
  unitsSold: 5,
};

const INTERNAL = 'relation "public.sales" does not exist';
const FALSE_ZEROS = /ref 0\.00|0,00|\b0 ventas|\+0\b/;

/** La tarjeta (su `article` o contenedor) que lleva esa etiqueta. */
function card(label: string) {
  return screen.getByText(label).closest("div")!.parentElement!;
}

describe("DashboardKpiCardsGrid · falla la consulta de métricas (REP-F10 N-04)", () => {
  it("no pinta ceros como si fueran datos: «—», error y «Reintentar»", async () => {
    const onRetryMetrics = jest.fn();
    render(
      <DashboardKpiCardsGrid
        metricsError={new Error("No pudimos cargar el reporte.")}
        onRetryMetrics={onRetryMetrics}
        preset="hoy"
        summary={summary}
      />,
    );

    expect(document.body.textContent).not.toMatch(FALSE_ZEROS);
    expect(screen.getByText("No pudimos cargar los indicadores de ventas")).toBeInTheDocument();
    expect(within(card("Ventas del día")).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(card("Total VES")).getAllByText("—").length).toBeGreaterThan(0);

    // Las tarjetas del resumen siguen con sus datos.
    expect(within(card("Total clientes")).getByText("4")).toBeInTheDocument();
    expect(within(card("Alertas stock")).getByText("2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetryMetrics).toHaveBeenCalledTimes(1);
  });

  it("una respuesta con `data: null` tampoco pinta ceros", () => {
    render(
      <DashboardKpiCardsGrid
        metrics={null}
        metricsError={new Error("No pudimos cargar el reporte.")}
        preset="rango"
        summary={summary}
      />,
    );

    expect(document.body.textContent).not.toMatch(FALSE_ZEROS);
    expect(screen.getByText("No pudimos cargar los indicadores de ventas")).toBeInTheDocument();
  });

  it("un 5xx no enseña el mensaje interno; un 4xx de negocio, el suyo", () => {
    const { unmount } = render(
      <DashboardKpiCardsGrid
        metricsError={new ClientApiError(500, "UNKNOWN_ERROR", INTERNAL)}
        preset="hoy"
        summary={summary}
      />,
    );

    expect(document.body).not.toHaveTextContent(/public\.sales/);
    expect(screen.getByText("No pudimos cargar los indicadores del periodo.")).toBeInTheDocument();
    unmount();

    render(
      <DashboardKpiCardsGrid
        metricsError={new ClientApiError(400, "BAD_REQUEST", 'La fecha "desde" no es válida.')}
        preset="hoy"
        summary={summary}
      />,
    );

    expect(screen.getByText('La fecha "desde" no es válida.')).toBeInTheDocument();
  });

  it("mientras se reintenta (cargando) no hay error ni ceros", () => {
    render(
      <DashboardKpiCardsGrid
        isMetricsLoading
        metricsError={new Error("No pudimos cargar el reporte.")}
        preset="hoy"
        summary={summary}
      />,
    );

    expect(screen.queryByText("No pudimos cargar los indicadores de ventas")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ref 0\.00|\b0 ventas/);
  });

  it("sin error, un día sin ventas sí pinta sus ceros", () => {
    render(
      <DashboardKpiCardsGrid
        metrics={{ ...metrics, paidVes: 0, salesCount: 0, totalRef: 0, totalVes: 0 }}
        preset="hoy"
        summary={summary}
      />,
    );

    expect(within(card("Ventas del día")).getByText("ref 0.00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });
});

describe("DashboardKpiCardsGrid · falla la consulta del resumen (REP-F10 N-12)", () => {
  it("el error se queda en las tarjetas del resumen; las de ventas siguen con sus cifras", async () => {
    const onRetrySummary = jest.fn();
    render(
      <DashboardKpiCardsGrid
        metrics={metrics}
        onRetrySummary={onRetrySummary}
        preset="hoy"
        summaryError={new ClientApiError(500, "UNKNOWN_ERROR", INTERNAL)}
      />,
    );

    expect(screen.getByText("No pudimos cargar el resumen")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar el resumen principal.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/public\.sales/);
    expect(within(card("Total clientes")).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(card("Alertas stock")).getAllByText("—").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\+0\b/);

    expect(within(card("Ventas del día")).getByText("ref 37.50")).toBeInTheDocument();
    expect(within(card("Ventas del día")).getByText("2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetrySummary).toHaveBeenCalledTimes(1);
  });
});
