/**
 * INV-F3 · el mini-gráfico del kardex no deja el aviso de tamaño de recharts en
 * la consola en su primer render (contenedor aún sin medir).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import type { ProductKardexPoint } from "../services/productKardex";
import { ProductKardexBalanceChart } from "./ProductKardexBalanceChart";

const SERIES: ProductKardexPoint[] = Array.from({ length: 30 }, (_, index) => ({
  balance: 9,
  date: new Date(Date.UTC(2026, 8, 9 + index, 12)).toISOString().slice(0, 10),
  entries: 0,
  exits: 0,
}));

describe("ProductKardexBalanceChart", () => {
  const originalResizeObserver = global.ResizeObserver;
  let rectSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Como en el navegador: el contenedor mide 400 × 160 una vez montado.
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ height: 160, width: 400 } as DOMRect);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    rectSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("dibuja la línea tras medir el contenedor sin avisar del tamaño en la consola", async () => {
    render(<ProductKardexBalanceChart series={SERIES} />);

    await waitFor(() =>
      expect(screen.getByRole("img").querySelector(".recharts-line-curve")).toBeInTheDocument(),
    );

    expect(
      warnSpy.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes("of chart should be greater than 0")),
    ).toEqual([]);
  });
});
