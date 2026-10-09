/**
 * REP-F8 · R-08: un doble o triple clic en «Descargar PDF» o «Descargar Excel»
 * genera un solo archivo. R-07: si falta la imagen del gráfico, el modal lo
 * avisa, deja reintentar la captura y vuelve a intentarla justo antes de
 * descargar.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  downloadReportsExcelFromDataset,
  downloadReportsPdfFromDataset,
} from "../../services/downloadReportsExport";
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

const pdfMock = jest.mocked(downloadReportsPdfFromDataset);
const excelMock = jest.mocked(downloadReportsExcelFromDataset);
const EXPORTED_AT = "2026-01-15T12:00:00.000Z";
const filters = { dateFilters: {}, purchasesFilters: {}, stockCardFilters: {} };
const chartImage = { dataUrl: "data:image/png;base64,AAAA", height: 480, width: 960 };
const data = {
  sections: [
    { columns: [], headerLines: ["Periodo a"], id: "a", periodLabel: "Periodo a", rows: [], title: "Hoja a" },
  ],
} as unknown as ReportsExportDataset;

function renderModal(extra: Partial<Parameters<typeof ReportsExportPreviewModal>[0]> = {}) {
  return render(
    <ReportsExportPreviewModal
      data={data}
      exportedAt={EXPORTED_AT}
      filters={filters}
      onOpenChange={() => undefined}
      open
      {...extra}
    />,
  );
}

function pdfButton() {
  return screen.getByRole("button", { name: "Descargar PDF" });
}

function excelButton() {
  return screen.getByRole("button", { name: "Descargar Excel" });
}

describe("ReportsExportPreviewModal · descargas (REP-F8 R-07, R-08)", () => {
  beforeEach(() => {
    pdfMock.mockReset();
    excelMock.mockReset().mockResolvedValue(undefined);
  });

  it("doble clic en «Descargar PDF»: un solo archivo", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.dblClick(pdfButton());

    expect(pdfMock).toHaveBeenCalledTimes(1);
  });

  it("triple clic en «Descargar PDF»: un solo archivo, y el botón queda ocupado un momento", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.tripleClick(pdfButton());

    expect(pdfMock).toHaveBeenCalledTimes(1);
    expect(pdfButton()).toBeDisabled();
    // Pasado el momento se puede volver a descargar a propósito.
    await waitFor(() => expect(pdfButton()).toBeEnabled(), { timeout: 3000 });
    await user.click(pdfButton());
    expect(pdfMock).toHaveBeenCalledTimes(2);
  });

  it("doble clic en «Descargar Excel»: un solo archivo aunque la primera descarga siga en curso", async () => {
    let finish: () => void = () => undefined;

    excelMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderModal();

    await user.dblClick(excelButton());

    expect(excelMock).toHaveBeenCalledTimes(1);
    expect(excelButton()).toBeDisabled();
    // Con una descarga en curso tampoco arranca la otra.
    expect(pdfButton()).toBeDisabled();

    finish();
    await waitFor(() => expect(pdfButton()).toBeEnabled());
  });

  it("tras descargar el PDF se puede descargar el Excel sin esperar", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(pdfButton());
    await user.click(excelButton());

    expect(pdfMock).toHaveBeenCalledTimes(1);
    expect(excelMock).toHaveBeenCalledTimes(1);
  });

  it("avisa de que el gráfico no se incluirá y deja reintentar la captura", async () => {
    const onRetryChartCapture = jest.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    renderModal({
      chartNotice: "El gráfico no se incluirá: aún se estaba cargando.",
      onRetryChartCapture,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "El gráfico no se incluirá: aún se estaba cargando.",
    );

    await user.click(screen.getByRole("button", { name: "Reintentar captura" }));

    expect(onRetryChartCapture).toHaveBeenCalledTimes(1);
  });

  it("sin imagen vuelve a capturar justo antes de descargar y usa la que consiga", async () => {
    const onRetryChartCapture = jest.fn().mockResolvedValue(chartImage);
    const user = userEvent.setup();
    renderModal({ onRetryChartCapture });

    await user.click(pdfButton());

    await waitFor(() => expect(pdfMock).toHaveBeenCalledWith(data, filters, EXPORTED_AT, chartImage));
    expect(onRetryChartCapture).toHaveBeenCalledTimes(1);
  });

  it("con imagen no vuelve a capturar", async () => {
    const onRetryChartCapture = jest.fn();
    const user = userEvent.setup();
    renderModal({ chartImage, onRetryChartCapture });

    await user.click(excelButton());

    expect(excelMock).toHaveBeenCalledWith(data, filters, EXPORTED_AT, chartImage);
    expect(onRetryChartCapture).not.toHaveBeenCalled();
  });

  it("un fallo interno al generar el archivo no enseña su mensaje", async () => {
    pdfMock.mockImplementation(() => {
      throw new Error("Cannot read properties of undefined (reading 'rows')");
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderModal();

    await user.click(pdfButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo descargar el PDF.");
    expect(document.body.textContent).not.toMatch(/Cannot read properties/);
    errorSpy.mockRestore();
  });
});
