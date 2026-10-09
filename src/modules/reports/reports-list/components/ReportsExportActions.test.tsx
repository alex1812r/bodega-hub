import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { captureChartImage } from "../../services/captureChartImage";
import {
  fetchReportsForExport,
  type ReportsExportDataset,
  type ReportsExportFilters,
} from "../../services/fetchReportsForExport";
import { ReportsExportActions } from "./ReportsExportActions";

const mockViewer = { permissions: ["reports.view", "inventory.view"], role: "admin" };

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => mockViewer,
}));

jest.mock("../../services/fetchReportsForExport", () => ({
  fetchReportsForExport: jest.fn(),
}));

jest.mock("../../services/captureChartImage", () => ({
  captureChartImage: jest.fn(),
}));

type ModalProps = {
  chartImage: unknown;
  data: unknown;
  exportedAt: string | null;
  filters: ReportsExportFilters;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const modalProps: ModalProps[] = [];

jest.mock("./ReportsExportPreviewModal", () => ({
  ReportsExportPreviewModal: (props: ModalProps) => {
    modalProps.push(props);

    return props.open ? (
      <div role="dialog">
        <button onClick={() => props.onOpenChange(false)} type="button">
          Cerrar
        </button>
      </div>
    ) : null;
  },
}));

const fetchMock = jest.mocked(fetchReportsForExport);
const captureMock = jest.mocked(captureChartImage);
const dataset = { dailySales: [] } as unknown as ReportsExportDataset;
const chartImage = { dataUrl: "data:image/png;base64,AAAA", height: 480, width: 960 };
const storeFilters: ReportsExportFilters = {
  dateFilters: { from: "2026-09-01", to: "2026-09-30" },
  purchasesFilters: { from: "2026-09-01", to: "2026-09-30" },
  stockCardFilters: {},
};

function lastModalProps() {
  return modalProps[modalProps.length - 1]!;
}

async function openPreview() {
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());

  return user;
}

beforeEach(() => {
  modalProps.length = 0;
  fetchMock.mockReset().mockResolvedValue(dataset);
  captureMock.mockReset().mockResolvedValue(chartImage);
  window.history.replaceState(null, "", "/reports");
});

describe("ReportsExportActions (REP-08)", () => {
  it("por tienda exporta lo que dice la URL: reporte abierto, filtros y sesión", async () => {
    window.history.replaceState(
      null,
      "",
      "/reports?report=receivables-aging&bucket=30%2B&contactId=c-1&compare=1&groupBy=week",
    );
    render(<ReportsExportActions exportFilters={storeFilters} />);

    await openPreview();

    const expectedFilters = {
      ...storeFilters,
      view: expect.objectContaining({
        activeReportId: "receivables-aging",
        bucket: "30+",
        compare: true,
        contactId: "c-1",
        groupBy: "week",
        viewer: { permissions: mockViewer.permissions, role: "admin" },
      }),
    };

    expect(fetchMock).toHaveBeenCalledWith(expectedFilters);
    expect(lastModalProps()).toMatchObject({ chartImage, data: dataset, filters: expectedFilters });
    expect(lastModalProps().exportedAt).toEqual(expect.any(String));
  });

  it("lee la URL al pulsar, no al montar: recoge los cambios hechos con replaceState", async () => {
    render(<ReportsExportActions exportFilters={storeFilters} />);
    window.history.replaceState(null, "", "/reports?report=purchases&status=recibido");

    await openPreview();

    expect(fetchMock.mock.calls[0]?.[0].view).toMatchObject({
      activeReportId: "purchases",
      purchasesStatus: "recibido",
    });
  });

  it("captura el gráfico visible una vez y lo pasa a la vista previa", async () => {
    render(<ReportsExportActions exportFilters={storeFilters} />);

    await openPreview();

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(lastModalProps().chartImage).toBe(chartImage);
  });

  it("si el gráfico no se puede capturar, la exportación sigue sin imagen", async () => {
    captureMock.mockResolvedValue(null);
    render(<ReportsExportActions exportFilters={storeFilters} />);

    await openPreview();

    expect(lastModalProps()).toMatchObject({ chartImage: null, data: dataset, open: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("plataforma exporta como siempre: sin vista de la URL y sin imagen", async () => {
    window.history.replaceState(null, "", "/platform/reports?report=purchases&compare=1");
    const platformFilters: ReportsExportFilters = {
      ...storeFilters,
      scope: { enabled: true, pathPrefix: "/api/platform/reports", storeScope: "all" },
    };
    render(<ReportsExportActions exportFilters={platformFilters} />);

    await openPreview();

    expect(fetchMock).toHaveBeenCalledWith(platformFilters);
    expect(fetchMock.mock.calls[0]?.[0].view).toBeUndefined();
    expect(captureMock).not.toHaveBeenCalled();
    expect(lastModalProps()).toMatchObject({ chartImage: null, filters: platformFilters });
  });

  it("plataforma sin tiendas elegidas deja el botón deshabilitado", () => {
    render(
      <ReportsExportActions
        exportFilters={{
          ...storeFilters,
          scope: { enabled: false, pathPrefix: "/api/platform/reports" },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Vista previa / exportar" })).toBeDisabled();
  });

  it("si la consulta falla muestra el error y no abre la vista previa", async () => {
    // Error de negocio del servidor: su mensaje sí se muestra (REP-F8 R-11).
    fetchMock.mockRejectedValue(
      new ClientApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion."),
    );
    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={storeFilters} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tienes permiso para realizar esta accion.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("al cerrar suelta los datos y la imagen; al reabrir vuelve a consultar y a capturar", async () => {
    render(<ReportsExportActions exportFilters={storeFilters} />);

    const user = await openPreview();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(lastModalProps()).toMatchObject({ chartImage: null, data: null, exportedAt: null });

    await openPreview();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captureMock).toHaveBeenCalledTimes(2);
  });
});
