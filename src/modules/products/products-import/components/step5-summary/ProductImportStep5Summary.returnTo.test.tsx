/**
 * DET-06d · "Volver a productos" del resumen de la importación regresa a la
 * lista de origen (`returnTo`) con sus filtros; sin él, a `/products`.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

const mockPush = jest.fn();
let mockSearch = "";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/import",
  useRouter: () => ({ back: jest.fn(), push: mockPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { ProductImportStep5Summary } from "./ProductImportStep5Summary";

function renderSummary() {
  return render(
    <ProductImportStep5Summary
      onDownloadLog={jest.fn()}
      onReset={jest.fn()}
      results={[{ rowIndex: 3, sku: "pan-1", status: "success" }]}
    />,
  );
}

describe("ProductImportStep5Summary · Volver a productos", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    mockPush.mockReset();
    mockSearch = "";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("sin returnTo vuelve a /products", () => {
    renderSummary();

    expect(screen.getByRole("link", { name: "Volver a productos" })).toHaveAttribute(
      "href",
      "/products",
    );
  });

  it("con returnTo vuelve a la lista con sus filtros", () => {
    const listUrl = "/products?margin=low&sort=marginPct&dir=desc&page=2";

    mockSearch = `returnTo=${encodeURIComponent(listUrl)}`;
    renderSummary();

    expect(screen.getByRole("link", { name: "Volver a productos" })).toHaveAttribute(
      "href",
      listUrl,
    );
  });

  it("un returnTo inseguro cae a /products y no hay atajos de teclado", () => {
    mockSearch = "returnTo=https%3A%2F%2Fevil.com";
    renderSummary();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Volver a productos" })).toHaveAttribute(
      "href",
      "/products",
    );
  });
});
