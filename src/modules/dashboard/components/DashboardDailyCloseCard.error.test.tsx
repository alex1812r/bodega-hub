/**
 * REP-F10 (N-03): la tarjeta «Cierre del día» del dashboard se quedaba en
 * «Cargando cierre del día…» para siempre si su consulta fallaba (500, corte de
 * red, 200 con HTML o `data: null`). Ahora pinta el error del tema con
 * «Reintentar», igual que el panel de Reportes.
 */
import "@testing-library/jest-dom";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardDailyCloseCard } from "./DashboardDailyCloseCard";

const LOADING_TEXT = "Cargando cierre del día…";
const GENERIC = "No pudimos cargar el reporte.";
const INTERNAL = 'relation "public.sales" does not exist';
const fetchMock = jest.fn();

function response(body: unknown, { contentType = "application/json", status = 200 } = {}) {
  return {
    headers: { get: () => contentType },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

const closeSummary = {
  cash: null,
  from: "2026-05-18",
  fx: {
    capitalRefToday: 10,
    depreciationPctOnVes: 1,
    usdHeldRef: 2,
    valuationRateVes: 520,
    vesExposed: 4000,
    vesLossRef: 0.5,
  },
  payments: [],
  paymentsSummary: { paymentCount: 3, totalRef: 10, totalVes: 5000 },
  sales: { salesCount: 3, totalRef: 10, totalVes: 5000 },
  to: "2026-05-18",
  vault: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <DashboardDailyCloseCard from="2026-05-18" periodLabel="Hoy" to="2026-05-18" />
    </QueryClientProvider>,
  );
}

describe("DashboardDailyCloseCard · error de la consulta (REP-F10 N-03)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    global.fetch = originalFetch;
  });

  it.each([
    ["500 con mensaje interno", () => response({ error: { code: "UNKNOWN_ERROR", message: INTERNAL } }, { status: 500 })],
    ["200 con HTML", () => response("<html></html>", { contentType: "text/html" })],
    ["200 con data null", () => response({ data: null })],
    [
      "corte de red",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: error genérico con «Reintentar», no «cargando» para siempre", async (_name, respond) => {
    fetchMock.mockImplementation(async () => respond());
    renderCard();

    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText(GENERIC)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/public\.sales|Failed to fetch|undefined/);
  });

  it("un error de negocio (4xx) enseña su mensaje", async () => {
    fetchMock.mockResolvedValue(
      response({ error: { code: "BAD_REQUEST", message: 'La fecha "desde" no es válida.' } }, { status: 400 }),
    );
    renderCard();

    expect(await screen.findByText('La fecha "desde" no es válida.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("«Reintentar» vuelve a pedir el cierre y lo pinta cuando la respuesta ya es buena", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "UNKNOWN_ERROR", message: INTERNAL } }, { status: 500 }));
    fetchMock.mockResolvedValue(response({ data: closeSummary }));
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("3 pagos activos")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("sin red avisa de que no hay conexión", async () => {
    onlineManager.setOnline(false);
    renderCard();

    await waitFor(() =>
      expect(screen.getByText("Sin conexión. Reintentaremos al volver la red.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
