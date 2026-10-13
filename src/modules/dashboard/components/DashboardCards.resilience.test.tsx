/**
 * REP-F8 · tarjetas del dashboard:
 * - R-05: una respuesta 200 malformada no tumba la página; solo la tarjeta
 *   afectada muestra su error con «Reintentar».
 * - R-06: sin red (consulta en pausa) no se pinta «no hay datos» ni ceros.
 * - R-10: la hora de las ventas recientes es la de Caracas, no la del navegador
 *   (el entorno de esta prueba pone el reloj local en Asia/Tokyo).
 *
 * @jest-environment ./src/modules/reports/reports-list/testing/tokyoTimezoneEnvironment.ts
 */

import "@testing-library/jest-dom";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import type { DashboardMetrics, DashboardSummary } from "../hooks/useDashboard";
import { DashboardDailyCloseCard } from "./DashboardDailyCloseCard";
import { DashboardKpiCardsGrid } from "./DashboardKpiCardsGrid";
import { DashboardLowStockCard } from "./DashboardLowStockCard";
import { DashboardPaymentMethodsCard } from "./DashboardPaymentMethodsCard";
import { DashboardRecentSalesCard, formatCaracasTime } from "./DashboardRecentSalesCard";
import { DashboardSalesChartCard } from "./DashboardSalesChartCard";

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, permissions: ["reports.view"], role: "admin" }),
}));

jest.mock("../../inventory/restock", () => ({
  RestockPurchaseButton: () => null,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const OFFLINE = "Sin conexión. Reintentaremos al volver la red.";
const CARD_ERROR = "No pudimos mostrar esta tarjeta";
const fetchMock = jest.fn();

function jsonResponse(data: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => ({ data }),
    ok: true,
    status: 200,
  };
}

/** Responde según la ruta pedida; lo demás, una página vacía. */
function respondWith(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string) => {
    const match = Object.keys(routes).find((path) => String(url).includes(path));

    return jsonResponse(match ? routes[match] : { items: [], limit: 10, skip: 0, total: 0 });
  });
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("tarjetas del dashboard · robustez (REP-F8)", () => {
  const originalFetch = global.fetch;
  const originalResizeObserver = global.ResizeObserver;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    // React registra en consola cada error que atrapa un límite: es lo esperado aquí.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    errorSpy.mockRestore();
    global.fetch = originalFetch;
    global.ResizeObserver = originalResizeObserver;
  });

  describe("R-05 · respuestas malformadas", () => {
    it("ventas recientes con campos nulos: solo esa tarjeta falla y «Reintentar» la recupera", async () => {
      respondWith({
        "low-stock": {
          items: [{ currentStock: 1, id: "p-1", minStock: 2, name: "Harina", sku: "H-1" }],
          limit: 8,
          skip: 0,
          total: 1,
        },
        "recent-sales": {
          items: [{ createdAt: null, customerName: null, id: "s-1", invoiceNumber: null, status: null, totalRef: null }],
          limit: 4,
          skip: 0,
          total: 1,
        },
      });
      renderWithClient(
        <>
          <DashboardRecentSalesCard />
          <DashboardLowStockCard totalCount={1} />
        </>,
      );

      expect(await screen.findByText(CARD_ERROR)).toBeInTheDocument();
      // La otra tarjeta sigue viva.
      expect(await screen.findByText("Harina")).toBeInTheDocument();

      respondWith({
        "recent-sales": {
          items: [
            {
              createdAt: "2026-05-11T03:30:00.000Z",
              customerName: "Ana",
              id: "s-1",
              invoiceNumber: "F-1",
              status: "paid",
              totalRef: 12,
            },
          ],
          limit: 4,
          skip: 0,
          total: 1,
        },
      });
      await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(await screen.findByText("F-1")).toBeInTheDocument();
      expect(screen.queryByText(CARD_ERROR)).not.toBeInTheDocument();
    });

    it("indicadores con números como texto o nulos: se pintan saneados, sin NaN", () => {
      const metrics = {
        from: null,
        paidVes: "x",
        pendingVes: null,
        salesCount: "muchas",
        to: null,
        totalRef: "abc",
        totalVes: null,
        unitsSold: null,
      } as unknown as DashboardMetrics;
      const summary = { activeCustomers: null, lowStockCount: "x", salesCount: null } as unknown as DashboardSummary;

      expect(() =>
        render(
          <DashboardKpiCardsGrid
            metrics={metrics}
            preset="hoy"
            previousMetrics={metrics}
            summary={summary}
          />,
        ),
      ).not.toThrow();

      expect(screen.getByText("Ventas del día")).toBeInTheDocument();
      expect(screen.getByText("ref 0.00")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/NaN|undefined|null|muchas|abc/);
    });

    it("flujo de ventas sin totales: no lanza fuera de la tarjeta", async () => {
      respondWith({
        "sales-trend": { items: [], series: { current: [{ key: "2026-05-12" }], groupBy: "day", totals: {} } },
      });

      renderWithClient(
        <>
          <p>El resto del dashboard</p>
          <DashboardSalesChartCard range={{ from: "2026-05-12", to: "2026-05-18" }} />
        </>,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.queryByText(CARD_ERROR) ?? screen.queryByText("Sin ventas en este periodo"),
        ).toBeInTheDocument(),
      );
      expect(screen.getByText("El resto del dashboard")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/NaN|undefined/);
    });
  });

  describe("R-06 · sin red", () => {
    beforeEach(() => {
      onlineManager.setOnline(false);
    });

    it("gráfico, ventas recientes, bajo stock, mix de pagos y cierre avisan de la conexión", async () => {
      renderWithClient(
        <>
          <section aria-label="grafico">
            <DashboardSalesChartCard range={{ from: "2026-05-12", to: "2026-05-18" }} />
          </section>
          <section aria-label="recientes">
            <DashboardRecentSalesCard />
          </section>
          <section aria-label="stock">
            <DashboardLowStockCard totalCount={0} />
          </section>
          <section aria-label="pagos">
            <DashboardPaymentMethodsCard from="2026-05-12" to="2026-05-18" />
          </section>
          <section aria-label="cierre">
            <DashboardDailyCloseCard from="2026-05-12" to="2026-05-18" />
          </section>
        </>,
      );

      for (const name of ["grafico", "recientes", "stock", "pagos", "cierre"]) {
        const card = screen.getByRole("region", { name });

        await waitFor(() => expect(within(card).getByText(OFFLINE)).toBeInTheDocument());
        expect(within(card).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Sin ventas en este periodo")).not.toBeInTheDocument();
      expect(screen.queryByText("No hay ventas recientes.")).not.toBeInTheDocument();
      expect(screen.queryByText(/No hay productos por debajo/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Cargando cierre/)).not.toBeInTheDocument();
    });

    it("indicadores sin datos del periodo: «—» y aviso de conexión, no ceros", () => {
      render(<DashboardKpiCardsGrid preset="rango" />);

      expect(screen.getByText(OFFLINE)).toBeInTheDocument();
      expect(screen.queryByText("ref 0.00")).not.toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });
  });

  describe("R-10 · hora de Caracas", () => {
    it("la prueba corre en otra zona horaria", () => {
      expect(new Date("2026-05-11T03:30:00.000Z").getHours()).toBe(12);
    });

    it("03:30 UTC son las 23:30 de Caracas", () => {
      expect(formatCaracasTime("2026-05-11T03:30:00.000Z")).toBe("23:30");
      expect(formatCaracasTime("2026-05-11T04:00:00.000Z")).toBe("00:00");
      expect(formatCaracasTime("no-es-fecha")).toBe("—");
    });

    it("ventas recientes pinta la hora de Caracas", async () => {
      respondWith({
        "recent-sales": {
          items: [
            {
              createdAt: "2026-05-11T03:30:00.000Z",
              customerName: "Ana",
              id: "s-1",
              invoiceNumber: "F-1",
              status: "paid",
              totalRef: 12,
            },
          ],
          limit: 4,
          skip: 0,
          total: 1,
        },
      });
      renderWithClient(<DashboardRecentSalesCard />);

      expect(await screen.findByText("23:30")).toBeInTheDocument();
      expect(screen.queryByText("12:30")).not.toBeInTheDocument();
    });
  });
});
