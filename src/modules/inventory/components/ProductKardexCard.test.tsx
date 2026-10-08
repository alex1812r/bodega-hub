/**
 * INV-03 · tarjeta de kardex del detalle de producto: estados, documento de
 * cada movimiento, enlaces con `returnTo`, saldo negativo y permiso.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPermission: { can: (permission: string) => boolean; isLoading: boolean } = {
  can: () => true,
  isLoading: false,
};

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => mockPermission,
}));

// jsdom no mide el contenedor: se le da un tamaño fijo para que el gráfico se dibuje.
jest.mock("recharts", () => {
  const actual = jest.requireActual<typeof import("recharts")>("recharts");
  const { cloneElement } = jest.requireActual<typeof import("react")>("react");

  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ height: number; width: number }>;
    }) => cloneElement(children, { height: 160, width: 400 }),
  };
});

import { inventoryQueryKeys } from "../hooks/useInventory";
import type { ProductKardex, ProductKardexMovement } from "../services/productKardex";
import { ProductKardexCard } from "./ProductKardexCard";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function isoDay(index: number) {
  // 30 días: del 9 de septiembre al 8 de octubre de 2026.
  return new Date(Date.UTC(2026, 8, 9 + index, 12)).toISOString().slice(0, 10);
}

function movement(overrides: Partial<ProductKardexMovement>): ProductKardexMovement {
  return {
    conversionId: null,
    createdAt: "2026-10-08T14:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-1",
    purchaseId: null,
    quantityDelta: 1,
    reason: null,
    saleId: null,
    stockAfter: 1,
    type: "ajuste_entrada",
    ...overrides,
  };
}

function kardex(overrides: Partial<ProductKardex> = {}): ProductKardex {
  return {
    entries30d: 10,
    exits30d: 6,
    lastMovements: [
      movement({
        documentKind: "venta",
        documentNumber: "V-000123",
        id: "mov-venta",
        quantityDelta: -2,
        saleId: "sale-1",
        stockAfter: 20,
        type: "venta",
      }),
      movement({
        documentKind: "compra",
        documentNumber: "C-000045",
        id: "mov-compra",
        purchaseId: "purchase-1",
        quantityDelta: 10,
        stockAfter: 22,
        type: "compra",
      }),
      movement({
        id: "mov-ajuste",
        quantityDelta: -3,
        reason: "Conteo físico",
        stockAfter: 12,
        type: "ajuste_salida",
      }),
      movement({
        conversionId: "conv-1",
        documentKind: "conversion",
        id: "mov-conversion",
        quantityDelta: -1,
        stockAfter: 15,
        type: "conversion_salida",
      }),
    ],
    openingBalance: 16,
    product: { currentStock: 20, id: "p-1", minStock: 5, name: "Cable HDMI", sku: "ELE-CAB-001" },
    series: Array.from({ length: 30 }, (_, index) => ({
      balance: index < 26 ? 16 : 20,
      date: isoDay(index),
      entries: index === 26 ? 10 : 0,
      exits: index === 26 ? 6 : 0,
    })),
    truncated: false,
    ...overrides,
  };
}

describe("ProductKardexCard", () => {
  let requests: string[];
  let responses: Array<Response | Promise<Response>>;
  let queryClient: QueryClient;

  beforeEach(() => {
    mockPermission.can = () => true;
    mockPermission.isLoading = false;
    requests = [];
    responses = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");

      requests.push(`${url.pathname}${url.search}`);

      return responses.shift() ?? jsonResponse({ data: kardex() });
    }) as unknown as typeof fetch;
  });

  function renderCard(returnTo: string | undefined = "/products/p-1") {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <ProductKardexCard productId="p-1" returnTo={returnTo} />
      </QueryClientProvider>,
    );
  }

  it("pide el kardex del producto y muestra saldo, mínimo, estado, entradas y salidas", async () => {
    renderCard();

    expect(await screen.findByText("Saldo actual")).toBeInTheDocument();
    expect(requests).toEqual(["/api/inventory/kardex?productId=p-1"]);

    const balance = screen.getByText("Saldo actual").closest("div") as HTMLElement;

    expect(within(balance).getByText("20")).toBeInTheDocument();
    expect(within(balance).getByText("Mínimo: 5")).toBeInTheDocument();
    expect(within(balance).getByText("En Stock")).toBeInTheDocument();
    expect(
      within(screen.getByText("Entradas 30 d").closest("div") as HTMLElement).getByText("+10"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Salidas 30 d").closest("div") as HTMLElement).getByText("-6"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Saldo hace 30 d").closest("div") as HTMLElement).getByText("16"),
    ).toBeInTheDocument();
  });

  it("muestra el esqueleto mientras carga", async () => {
    let resolve: (response: Response) => void = () => undefined;

    responses.push(new Promise<Response>((done) => (resolve = done)));
    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("Cargando kardex...");
    expect(screen.queryByText("Últimos movimientos")).not.toBeInTheDocument();

    await act(async () => resolve(jsonResponse({ data: kardex() })));

    expect(await screen.findByText("Últimos movimientos")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("el gráfico es una imagen con resumen de inicio a fin y los datos van también en una tabla", async () => {
    renderCard();

    const chart = await screen.findByRole("img");

    expect(chart).toHaveAccessibleName(
      "Saldo de los últimos 30 días: de 16 unidades el 09/09 a 20 unidades el 08/10. Mínimo 16, máximo 20.",
    );

    const table = screen.getByRole("table", { name: "Saldo diario de los últimos 30 días" });
    const rows = within(table).getAllByRole("row");

    expect(chart.querySelector(".recharts-line-curve")).toBeInTheDocument();
    // Sin saldos negativos no hay línea de cero.
    expect(chart.querySelector(".recharts-reference-line")).not.toBeInTheDocument();

    // Cabecera + 30 días.
    expect(rows).toHaveLength(31);
    expect(within(rows[27]).getByRole("rowheader")).toHaveTextContent("05/10");
    expect(within(rows[27]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "10",
      "6",
      "20",
    ]);
  });

  it("lista los movimientos con cantidad con signo, saldo, fecha y motivo", async () => {
    renderCard();

    const items = await screen.findAllByRole("listitem");

    expect(items).toHaveLength(4);
    expect(within(items[0]).getByText("-2")).toBeInTheDocument();
    expect(within(items[0]).getByText("Saldo: 20")).toBeInTheDocument();
    expect(within(items[0]).getByText("Venta")).toBeInTheDocument();
    // 14:00 UTC = 10:00 en Caracas.
    expect(within(items[0]).getByText(/08\/10\/2026.*10:00/)).toBeInTheDocument();
    expect(within(items[1]).getByText("+10")).toBeInTheDocument();
    expect(within(items[1]).getByText("Saldo: 22")).toBeInTheDocument();
    expect(within(items[2]).getByText("-3")).toBeInTheDocument();
    expect(within(items[2]).getByText("Conteo físico")).toBeInTheDocument();
  });

  it('enlaza la venta y la compra a su detalle, y un movimiento sin documento dice "Ajuste manual"', async () => {
    renderCard();

    const items = await screen.findAllByRole("listitem");

    expect(within(items[0]).getByRole("link", { name: "Venta V-000123" })).toHaveAttribute(
      "href",
      "/sales/sale-1?returnTo=%2Fproducts%2Fp-1",
    );
    expect(within(items[1]).getByRole("link", { name: "Compra C-000045" })).toHaveAttribute(
      "href",
      "/purchases/purchase-1?returnTo=%2Fproducts%2Fp-1",
    );
    expect(within(items[2]).getByText("Ajuste manual")).toBeInTheDocument();
    expect(within(items[2]).queryByRole("link")).not.toBeInTheDocument();
    expect(within(items[3]).getByText("Conversión de empaque")).toBeInTheDocument();
    expect(within(items[3]).queryByText("Ajuste manual")).not.toBeInTheDocument();
  });

  it("una venta sin número muestra el tipo y no se trata como ajuste manual", async () => {
    responses.push(
      jsonResponse({
        data: kardex({
          lastMovements: [
            movement({ documentKind: "venta", id: "mov-x", saleId: "sale-9", type: "venta" }),
          ],
        }),
      }),
    );
    renderCard();

    const item = await screen.findByRole("listitem");

    expect(within(item).getByRole("link", { name: "Venta" })).toHaveAttribute(
      "href",
      "/sales/sale-9?returnTo=%2Fproducts%2Fp-1",
    );
    expect(within(item).queryByText("Ajuste manual")).not.toBeInTheDocument();
  });

  it('"Ver kardex completo" lleva a los movimientos del producto con returnTo codificado', async () => {
    renderCard("/products/p-1?tab=resumen");

    expect(await screen.findByRole("link", { name: "Ver kardex completo" })).toHaveAttribute(
      "href",
      "/inventory/movements?productId=p-1&returnTo=%2Fproducts%2Fp-1%3Ftab%3Dresumen",
    );
  });

  it("sin returnTo el enlace al kardex completo solo lleva el producto", async () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProductKardexCard productId="p-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("link", { name: "Ver kardex completo" })).toHaveAttribute(
      "href",
      "/inventory/movements?productId=p-1",
    );
  });

  it("un producto sin movimientos muestra igual el saldo y el gráfico plano; el vacío va solo en la lista", async () => {
    responses.push(
      jsonResponse({
        data: kardex({
          entries30d: 0,
          exits30d: 0,
          lastMovements: [],
          openingBalance: 9,
          product: { currentStock: 9, id: "p-1", minStock: 5, name: "Pintura", sku: "PIN" },
          series: Array.from({ length: 30 }, (_, index) => ({
            balance: 9,
            date: isoDay(index),
            entries: 0,
            exits: 0,
          })),
        }),
      }),
    );
    renderCard();

    expect(await screen.findByText("Este producto aún no tiene movimientos.")).toBeInTheDocument();

    const balance = screen.getByText("Saldo actual").closest("div") as HTMLElement;

    expect(within(balance).getByText("9")).toBeInTheDocument();
    expect(within(balance).getByText("Mínimo: 5")).toBeInTheDocument();
    expect(within(balance).getByText("En Stock")).toBeInTheDocument();

    const chart = screen.getByRole("img");
    const heights = (chart.querySelector(".recharts-line-curve")?.getAttribute("d") ?? "")
      .split("L")
      .map((point) => point.split(",")[1]);

    expect(chart).toHaveAccessibleName(
      "Saldo de los últimos 30 días: de 9 unidades el 09/09 a 9 unidades el 08/10. Mínimo 9, máximo 9.",
    );
    // Línea plana: los 30 puntos a la misma altura.
    expect(heights).toHaveLength(30);
    expect(new Set(heights).size).toBe(1);
    expect(screen.getByText("Últimos movimientos")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver kardex completo" })).toBeInTheDocument();
  });

  it("el enlace a un documento conserva el returnTo con el que se llegó a la pantalla", async () => {
    const origin = `/products/p-1?returnTo=${encodeURIComponent("/products?page=2")}`;

    renderCard(origin);

    const items = await screen.findAllByRole("listitem");
    const href = within(items[0]).getByRole("link", { name: "Venta V-000123" }).getAttribute("href");

    expect(href?.split("?")[0]).toBe("/sales/sale-1");
    expect(new URLSearchParams(href?.split("?")[1]).get("returnTo")).toBe(origin);
  });

  it("un saldo histórico negativo se muestra y se resume sin romper el gráfico", async () => {
    responses.push(
      jsonResponse({
        data: kardex({
          lastMovements: [movement({ id: "mov-neg", quantityDelta: 5, stockAfter: 2 })],
          openingBalance: -3,
          product: { currentStock: 2, id: "p-1", minStock: 5, name: "Cable", sku: "CAB" },
          series: Array.from({ length: 30 }, (_, index) => ({
            balance: index < 29 ? -3 : 2,
            date: isoDay(index),
            entries: index === 29 ? 5 : 0,
            exits: 0,
          })),
        }),
      }),
    );
    renderCard();

    const chart = await screen.findByRole("img");

    // El eje baja hasta -3 (la curva arranca en el borde inferior y termina arriba, en 2) y aparece la línea de cero.
    expect(chart.querySelector(".recharts-line-curve")?.getAttribute("d")).toMatch(/^M36,130L.*L392,8$/);
    expect(chart.querySelector(".recharts-line-curve")?.getAttribute("d")).not.toContain("NaN");
    expect(chart.querySelector(".recharts-reference-line")).toBeInTheDocument();
    expect(chart).toHaveAccessibleName(
      "Saldo de los últimos 30 días: de -3 unidades el 09/09 a 2 unidades el 08/10. Mínimo -3, máximo 2.",
    );
    expect(
      within(screen.getByText("Saldo hace 30 d").closest("div") as HTMLElement).getByText("-3"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stock Bajo")).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).getAllByRole("row")[1],
    ).toHaveTextContent("09/09" + "0" + "0" + "-3");
  });

  it("avisa cuando la respuesta viene truncada y marca los días sin dato", async () => {
    responses.push(
      jsonResponse({
        data: kardex({
          openingBalance: null,
          series: Array.from({ length: 30 }, (_, index) =>
            index < 28
              ? { balance: null, date: isoDay(index), entries: null, exits: null }
              : { balance: 20, date: isoDay(index), entries: 0, exits: 0 },
          ),
          truncated: true,
        }),
      }),
    );
    renderCard();

    expect(await screen.findByRole("note")).toHaveTextContent(
      "Este producto tiene demasiados movimientos en 30 días: el gráfico y los totales cuentan desde el 07/10. Abre el kardex completo para ver el resto.",
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Saldo de los últimos 30 días: de 20 unidades el 07/10 a 20 unidades el 08/10. Mínimo 20, máximo 20.",
    );
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent(
      "09/09Sin datoSin datoSin dato",
    );
    expect(
      within(screen.getByText("Saldo hace 30 d").closest("div") as HTMLElement).getByText("—"),
    ).toBeInTheDocument();
  });

  it("truncado sin ningún día completo: aviso sin gráfico", async () => {
    responses.push(
      jsonResponse({
        data: kardex({
          openingBalance: null,
          series: Array.from({ length: 30 }, (_, index) => ({
            balance: null,
            date: isoDay(index),
            entries: null,
            exits: null,
          })),
          truncated: true,
        }),
      }),
    );
    renderCard();

    expect(await screen.findByRole("note")).toHaveTextContent(
      "Este producto tiene demasiados movimientos en 30 días para resumirlos aquí.",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("no avisa de truncado en una respuesta completa", async () => {
    renderCard();

    await screen.findByText("Últimos movimientos");

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("si falla la carga muestra el error y reintenta", async () => {
    responses.push(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Algo salió mal." } }, 500),
    );
    renderCard();

    expect(await screen.findByText("No pudimos cargar el kardex")).toBeInTheDocument();
    expect(screen.getByText("Algo salió mal.")).toBeInTheDocument();

    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Últimos movimientos")).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it("si el servidor responde 403 muestra el aviso de permiso, sin reintento ni enlace", async () => {
    responses.push(
      jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403),
    );
    renderCard();

    expect(
      await screen.findByText("No tienes permiso para ver los movimientos de inventario."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ver kardex completo" })).not.toBeInTheDocument();
  });

  it("sin inventory.view no pinta la tarjeta ni consulta el kardex", async () => {
    mockPermission.can = (permission) => permission !== "inventory.view";

    const { container } = renderCard();

    await act(async () => undefined);

    expect(container).toBeEmptyDOMElement();
    expect(requests).toEqual([]);
  });

  it("mientras se resuelven los permisos no pinta ni consulta", async () => {
    mockPermission.isLoading = true;

    const { container } = renderCard();

    await act(async () => undefined);

    expect(container).toBeEmptyDOMElement();
    expect(requests).toEqual([]);
  });

  it("se refresca al invalidar las consultas de inventario (ajustes y conversiones)", async () => {
    renderCard();
    await screen.findByText("Últimos movimientos");

    responses.push(
      jsonResponse({
        data: kardex({
          product: { currentStock: 25, id: "p-1", minStock: 5, name: "Cable HDMI", sku: "CAB" },
        }),
      }),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all });
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(
      await within(screen.getByText("Saldo actual").closest("div") as HTMLElement).findByText("25"),
    ).toBeInTheDocument();
  });
});
