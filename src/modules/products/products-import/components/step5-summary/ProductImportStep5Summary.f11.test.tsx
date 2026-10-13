import { render, screen } from "@testing-library/react";

import { ProductImportStep5Summary } from "./ProductImportStep5Summary";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/import",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("ProductImportStep5Summary (PRO-F11)", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
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

  it("no anuncia éxito cuando hay filas que no se crearon", () => {
    render(
      <ProductImportStep5Summary
        onDownloadLog={jest.fn()}
        onReset={jest.fn()}
        results={[
          { rowIndex: 3, sku: "pan-1", status: "success" },
          { error: 'La categoria "X" no existe.', rowIndex: 4, sku: "pan-2", status: "failed" },
        ]}
      />,
    );

    expect(screen.queryByText("¡Proceso finalizado exitosamente!")).not.toBeInTheDocument();
    expect(screen.getByText("Importación finalizada con filas sin crear")).toBeInTheDocument();
    expect(screen.getByText('La categoria "X" no existe.')).toBeInTheDocument();
  });

  it("PRO-F12: una fila omitida no lleva la etiqueta de error en el detalle", () => {
    render(
      <ProductImportStep5Summary
        cancelled
        onDownloadLog={jest.fn()}
        onReset={jest.fn()}
        results={[
          { rowIndex: 3, sku: "pan-1", status: "success" },
          { error: "Cancelada: puede haberse creado; revisa la lista.", rowIndex: 4, sku: "pan-2", status: "skipped" },
          { error: "El recurso ya existe.", rowIndex: 5, sku: "pan-3", status: "failed" },
        ]}
      />,
    );

    const rowOf = (text: string) => screen.getByText(text).closest("tr");

    expect(rowOf("Cancelada: puede haberse creado; revisa la lista.")).toHaveTextContent("Advertencia");
    expect(rowOf("Cancelada: puede haberse creado; revisa la lista.")).not.toHaveTextContent("Error");
    expect(rowOf("El recurso ya existe.")).toHaveTextContent("Error");
  });

  it("anuncia éxito solo si todas las filas se crearon", () => {
    render(
      <ProductImportStep5Summary
        onDownloadLog={jest.fn()}
        onReset={jest.fn()}
        results={[{ rowIndex: 3, sku: "pan-1", status: "success" }]}
      />,
    );

    expect(screen.getByText("¡Proceso finalizado exitosamente!")).toBeInTheDocument();
  });
});
