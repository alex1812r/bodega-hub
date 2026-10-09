/**
 * CNF-15 · guardia del asistente de importación: desde que hay un archivo cargado
 * (paso 2) hasta que la importación termina, salir pregunta antes; la plantilla
 * (paso 1) y el resumen final salen sin preguntar.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";

import type { ProductImportStatus, ProductImportStep, ProductImportValidatedRow } from "../types";

const mockPush = jest.fn();
const mockBulk: {
  status: ProductImportStatus;
  step: ProductImportStep;
  validatedRows: ProductImportValidatedRow[];
} = { status: "idle", step: "template", validatedRows: [] };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));
// Enlace reducido a su <a>: el guardia lo intercepta en el documento.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
jest.mock("../../hooks/useProducts", () => ({
  useAllCategories: () => ({ data: { items: [] }, isError: false, isLoading: false }),
}));
jest.mock("../hooks/useProductBulkImport", () => ({
  useProductBulkImport: () => ({
    ...mockBulk,
    errorMessage: null,
    fileName: null,
    progress: { failed: 0, processed: 0, succeeded: 0, total: 0 },
    results: [],
  }),
}));
// Los pasos no importan aquí: solo en cuál está el asistente.
jest.mock("./step1-template/ProductImportStep1Template", () => ({
  ProductImportStep1Template: () => null,
}));
jest.mock("./step2-file/ProductImportStep2File", () => ({ ProductImportStep2File: () => null }));
jest.mock("./step3-preview/ProductImportStep3Preview", () => ({
  ProductImportStep3Preview: () => null,
}));
jest.mock("./step4-importing/ProductImportStep4Importing", () => ({
  ProductImportStep4Importing: () => null,
}));
jest.mock("./step5-summary/ProductImportStep5Summary", () => ({
  downloadProductImportResultsCsv: jest.fn(),
  ProductImportStep5Summary: () => null,
}));

import {
  getProductImportGuardLabel,
  isProductImportGuarded,
  ProductImportWizard,
} from "./ProductImportWizard";

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ rowIndex: index + 2 })) as ProductImportValidatedRow[];
}

function Screen() {
  return (
    <>
      <Link href="/sales">Ventas</Link>
      <ProductImportWizard />
    </>
  );
}

function renderWizard(state: Partial<typeof mockBulk>) {
  Object.assign(mockBulk, { status: "idle", step: "template", validatedRows: [] }, state);

  return render(<Screen />);
}

function leaveViaMenu() {
  fireEvent.click(screen.getByRole("link", { name: "Ventas" }));
}

function guardDialog() {
  return screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
}

/** Sin guardia el clic llegaría al navegador: jsdom no navega y lo registraría como error. */
function swallowNavigation(event: MouseEvent) {
  event.preventDefault();
}

beforeAll(() => {
  document.addEventListener("click", swallowNavigation);
});

afterAll(() => {
  document.removeEventListener("click", swallowNavigation);
});

beforeEach(() => {
  mockPush.mockReset();
});

describe("ProductImportWizard · guardia de salida (CNF-15)", () => {
  it.each<[string, Partial<typeof mockBulk>]>([
    ["paso 1, plantilla", { step: "template" }],
    ["paso 2 sin archivo cargado", { step: "file" }],
    ["paso 2 con un archivo que no se pudo leer", { status: "error", step: "file" }],
    ["resumen de una importación terminada", { status: "done", step: "summary", validatedRows: rows(120) }],
    ["resumen de una importación cancelada", { status: "cancelled", step: "summary", validatedRows: rows(120) }],
  ])("%s: sale directo, sin pregunta ni aviso al recargar", (_name, state) => {
    renderWizard(state);

    leaveViaMenu();

    expect(guardDialog()).not.toBeInTheDocument();
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it.each<[string, Partial<typeof mockBulk>, string]>([
    [
      "paso 2 leyendo el archivo",
      { status: "parsing", step: "file" },
      "Importación de productos · paso 2 de 5",
    ],
    [
      "paso 2 al volver desde la vista previa",
      { status: "validated", step: "file", validatedRows: rows(120) },
      "Importación de productos · paso 2 de 5 · 120 filas",
    ],
    [
      "paso 3, vista previa",
      { status: "validated", step: "preview", validatedRows: rows(120) },
      "Importación de productos · paso 3 de 5 · 120 filas",
    ],
    [
      "paso 3 con una sola fila",
      { status: "validated", step: "preview", validatedRows: rows(1) },
      "Importación de productos · paso 3 de 5 · 1 fila",
    ],
    [
      "paso 4, importando",
      { status: "importing", step: "importing", validatedRows: rows(120) },
      "Importación de productos · paso 4 de 5 · 120 filas",
    ],
  ])("%s: pregunta al navegar nombrando el paso y avisa al recargar", (_name, state, label) => {
    renderWizard(state);

    expect(dispatchBeforeUnload()).toBe(true);

    leaveViaMenu();

    const guard = screen.getByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(within(guard).getByText(label)).toBeInTheDocument();
    expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("«Seguir aquí» deja el asistente donde estaba; «Salir» navega al destino pedido", async () => {
    renderWizard({ status: "validated", step: "preview", validatedRows: rows(120) });

    leaveViaMenu();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));

    expect(guardDialog()).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Importación Masiva de Productos" }),
    ).toBeInTheDocument();

    leaveViaMenu();
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));

    expect(await screen.findByRole("link", { name: "Ventas" })).toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith("/sales");
    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("al terminar la importación el guardia se apaga: el resumen sale sin preguntar", () => {
    const view = renderWizard({ status: "importing", step: "importing", validatedRows: rows(120) });

    expect(dispatchBeforeUnload()).toBe(true);

    Object.assign(mockBulk, { status: "done", step: "summary" });
    view.rerender(<Screen />);

    expect(dispatchBeforeUnload()).toBe(false);

    leaveViaMenu();

    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("isProductImportGuarded y getProductImportGuardLabel siguen el paso y las filas", () => {
    expect(isProductImportGuarded({ rowCount: 0, status: "idle", step: "template" })).toBe(false);
    expect(isProductImportGuarded({ rowCount: 120, status: "validated", step: "template" })).toBe(false);
    expect(isProductImportGuarded({ rowCount: 0, status: "idle", step: "file" })).toBe(false);
    expect(isProductImportGuarded({ rowCount: 0, status: "parsing", step: "file" })).toBe(true);
    expect(isProductImportGuarded({ rowCount: 0, status: "error", step: "preview" })).toBe(true);
    expect(isProductImportGuarded({ rowCount: 120, status: "done", step: "summary" })).toBe(false);
    expect(getProductImportGuardLabel({ rowCount: 0, status: "parsing", step: "file" })).toBe(
      "Importación de productos · paso 2 de 5",
    );
  });
});
