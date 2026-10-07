import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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
  return { columns: [], id, periodLabel: `Periodo ${id}`, rows: [], title: `Hoja ${id}` };
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

  it("shows the empty message without data", () => {
    render(modal(null));

    expect(screen.getByText("No hay datos para previsualizar.")).toBeVisible();
  });
});
