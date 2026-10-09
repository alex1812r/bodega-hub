/**
 * REP-F8 · R-06: sin red la consulta queda en pausa (ni carga ni falla) y el
 * panel no la toma por un reporte vacío. R-11: un fallo que no es de negocio no
 * enseña su mensaje interno (la clave de la consulta).
 *
 * Con los hooks reales y `onlineManager`: es React Query quien pausa.
 */
import "@testing-library/jest-dom";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { getReportById, type ReportId } from "../config/reportCatalog";
import { ReportsResultPanel } from "./ReportsResultPanel";

jest.mock("../../../inventory/restock", () => ({
  RestockPurchaseButton: () => null,
}));

const RANGE = { from: "2026-05-01", to: "2026-05-18" };
const OFFLINE = "Sin conexión. Reintentaremos al volver la red.";
const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function renderPanel(id: ReportId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ReportsResultPanel
        dateFilters={RANGE}
        purchasesFilters={RANGE}
        report={getReportById(id)}
        stockCardFilters={{}}
      />
    </QueryClientProvider>,
  );
}

describe("ReportsResultPanel · sin red y errores internos (REP-F8 R-06, R-11)", () => {
  const originalFetch = global.fetch;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: !query.includes("max-width"),
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
      writable: true,
    });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    global.fetch = originalFetch;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it.each(["daily-sales", "top-products", "low-stock"] as const)(
    "%s sin red: avisa de la conexión en vez de «sin datos»",
    async (reportId) => {
      onlineManager.setOnline(false);
      renderPanel(reportId);

      await waitFor(() => expect(screen.getAllByText(OFFLINE).length).toBeGreaterThan(0));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Sin datos en este periodo")).not.toBeInTheDocument();
      expect(screen.queryByText(/No hay registros/)).not.toBeInTheDocument();
      expect(screen.queryByText("Sin registros")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Reintentar" }).length).toBeGreaterThan(0);
    },
  );

  it("al volver la red se reanuda sola y pinta los datos", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          items: [{ currentStock: 1, id: "p-1", minStock: 2, name: "Harina", sku: "H-1" }],
          limit: 10,
          skip: 0,
          total: 1,
        },
      }),
    );
    onlineManager.setOnline(false);
    renderPanel("low-stock");

    await waitFor(() => expect(screen.getAllByText(OFFLINE).length).toBeGreaterThan(0));

    onlineManager.setOnline(true);

    await waitFor(() => expect(screen.getByText("Harina")).toBeInTheDocument());
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });

  it("una respuesta sin el sobre `data` muestra un texto genérico, no la clave de la consulta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    renderPanel("daily-sales");

    const region = await screen.findByRole("region", { name: "Gráfico: Ventas diarias" });

    await waitFor(() =>
      expect(within(region).getByText("No pudimos cargar el reporte.")).toBeInTheDocument(),
    );
    expect(document.body.textContent).not.toMatch(/Affected query key|daily-sales|data is undefined|\["reports"/);
    expect(screen.getAllByText("No pudimos cargar el reporte.").length).toBeGreaterThan(1);

    // «Reintentar» vuelve a pedir el reporte.
    const calls = fetchMock.mock.calls.length;

    await userEvent.click(within(region).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
    errorSpy.mockRestore();
  });

  it("un error de negocio del servidor sí enseña su mensaje", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "VALIDATION_ERROR", message: "El rango no es válido." } }, 400),
    );
    renderPanel("daily-sales");

    await waitFor(() => expect(screen.getAllByText("El rango no es válido.").length).toBeGreaterThan(0));
  });
});
