import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ReportsExportDataset } from "../../services/fetchReportsForExport";
import type { ReportExportSection } from "../../utils/reportExportSections";
import { ReportsExportPreviewModal } from "./ReportsExportPreviewModal";

type FakeDataset = { sections: ReportExportSection[] };

jest.mock("../../services/downloadReportsExport", () => ({
  downloadReportsExcelFromDataset: jest.fn(),
  downloadReportsPdfFromDataset: jest.fn(),
}));

jest.mock("../../utils/reportExportSections", () => ({
  ...jest.requireActual("../../utils/reportExportSections"),
  buildReportExportSections: (data: FakeDataset) => data.sections,
}));

function section(id: string): ReportExportSection {
  return {
    columns: [],
    id,
    periodLabel: `Periodo ${id}`,
    // La hoja "b" lleva dos filas: su pestaña muestra el contador.
    rows: id === "b" ? [{}, {}] : [],
    title: `Hoja ${id}`,
  } as ReportExportSection;
}

function dataset(...ids: string[]) {
  return { sections: ids.map(section) } as unknown as ReportsExportDataset;
}

const filters = { dateFilters: {}, purchasesFilters: {}, stockCardFilters: {} };
const abc = dataset("a", "b", "c");
const ac = dataset("a", "c");

function modal(data: ReportsExportDataset | null, open = true) {
  return (
    <ReportsExportPreviewModal
      data={data}
      exportedAt="2026-01-15T12:00:00.000Z"
      filters={filters}
      onOpenChange={() => undefined}
      open={open}
    />
  );
}

function selectedTab() {
  return screen.getByRole("tab", { selected: true });
}

describe("ReportsExportPreviewModal", () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(() => {
    // La paginación de una hoja con filas consulta el ancho de la pantalla.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  // REP-F2: «generada el 15/1/2026, 8:00:00 a. m..» acababa en doble punto.
  it("dice cuándo se generó con hora de Caracas en 24 h y un solo punto", () => {
    render(modal(abc));

    const description = screen.getByText(/^Vista previa generada el /);

    expect(description).toHaveTextContent(
      /^Vista previa generada el 15\/01\/2026,? 08:00\. Revisa las hojas antes de descargar\.$/,
    );
  });

  it("opens on the first sheet", () => {
    render(modal(abc));

    expect(selectedTab()).toHaveTextContent("Hoja a");
    expect(screen.getByText("Periodo a")).toBeVisible();
  });

  it("keeps the chosen sheet after closing and reopening", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(abc));

    await user.click(screen.getByRole("tab", { name: /Hoja b/ }));
    expect(selectedTab()).toHaveTextContent("Hoja b");

    rerender(modal(abc, false));
    rerender(modal(abc));

    expect(selectedTab()).toHaveTextContent("Hoja b");
  });

  it("falls back to the first sheet for good when the chosen one disappears while open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(abc));

    await user.click(screen.getByRole("tab", { name: /Hoja b/ }));
    rerender(modal(ac));
    expect(selectedTab()).toHaveTextContent("Hoja a");

    rerender(modal(abc));
    expect(selectedTab()).toHaveTextContent("Hoja a");
  });

  it("does not forget the chosen sheet when the sheets change while closed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(abc));

    await user.click(screen.getByRole("tab", { name: /Hoja b/ }));
    rerender(modal(abc, false));
    rerender(modal(ac, false));
    rerender(modal(abc));

    expect(selectedTab()).toHaveTextContent("Hoja b");
  });

  it("uses the shared Tabs: one tab per sheet with its row count, only the active panel", async () => {
    const user = userEvent.setup();
    render(modal(abc));

    const tablist = screen.getByRole("tablist", { name: "Hojas del reporte" });
    const tabs = within(tablist).getAllByRole("tab");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Hoja a0", "Hoja b2", "Hoja c0"]);
    // Roving tabindex del componente compartido: solo la pestaña activa entra en el orden de tabulación.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Hoja a/);

    await user.click(tabs[1]);

    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Hoja b/);
    expect(screen.getByText("Periodo b")).toBeVisible();
    expect(screen.queryByText("Periodo a")).not.toBeInTheDocument();
  });

  it("moves between sheets with the arrow keys", async () => {
    const user = userEvent.setup();
    render(modal(abc));

    selectedTab().focus();
    await user.keyboard("{ArrowRight}");
    expect(selectedTab()).toHaveTextContent("Hoja b");

    await user.keyboard("{End}");
    expect(selectedTab()).toHaveTextContent("Hoja c");
    expect(selectedTab()).toHaveFocus();
  });

  it("does not write the active sheet to the URL", async () => {
    const user = userEvent.setup();
    const replaceState = jest.spyOn(window.history, "replaceState");
    const before = window.location.href;
    render(modal(abc));

    await user.click(screen.getByRole("tab", { name: /Hoja c/ }));

    expect(selectedTab()).toHaveTextContent("Hoja c");
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    replaceState.mockRestore();
  });

  it("shows the empty message without data", () => {
    render(modal(null));

    expect(screen.getByText("No hay datos para previsualizar.")).toBeVisible();
  });
});
