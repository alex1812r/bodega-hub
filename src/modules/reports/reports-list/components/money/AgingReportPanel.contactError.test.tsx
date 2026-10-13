/**
 * REP-F9: el error de leer el contacto filtrado no se enseña crudo. Solo un
 * error de negocio (`ClientApiError`) muestra su mensaje; el resto, el genérico.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { ClientApiError } from "@/shared/api/apiFetch";

import { buildAgingSummary } from "../../../services/moneyReports";
import { AgingReportPanel } from "./AgingReportPanel";

let mockContactQuery: { data?: unknown; error?: Error | null; isPaused?: boolean } = {};

jest.mock("../../../hooks/useMoneyReports", () => {
  const { buildAgingSummary: summarize } = jest.requireActual("../../../services/moneyReports");
  const hook = () => ({
    data: { items: [], limit: 10, skip: 0, summary: summarize([]), total: 0 },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });

  return { usePayablesAgingReport: hook, useReceivablesAgingReport: hook };
});

jest.mock("../../../../contacts/hooks/useContacts", () => ({
  useContact: (id?: string) => ({
    data: undefined,
    error: null,
    isPaused: false,
    ...(id ? mockContactQuery : {}),
  }),
}));

jest.mock("../../../../../shared/components/EntityAutocomplete", () => ({
  EntityAutocomplete: ({ error }: { error?: string }) => (
    <div data-testid="contact-filter-error">{error ?? ""}</div>
  ),
}));

function renderPanel() {
  return render(
    <AgingReportPanel
      contactId="cli-1"
      kind="receivables"
      onFiltersChange={jest.fn()}
      pagination={{ limit: 10, setLimit: jest.fn(), setSkip: jest.fn(), skip: 0 }}
      report={{ name: "Cuentas por cobrar" }}
    />,
  );
}

describe("AgingReportPanel · error del contacto filtrado (REP-F9)", () => {
  beforeEach(() => {
    mockContactQuery = {};
  });

  it("el resumen vacío de la prueba no trae documentos", () => {
    expect(buildAgingSummary([]).totals.documentsCount).toBe(0);
  });

  it("un error de negocio enseña su mensaje tal cual", () => {
    mockContactQuery = { error: new ClientApiError(404, "NOT_FOUND", "Contacto no encontrado.") };
    renderPanel();

    expect(screen.getByTestId("contact-filter-error")).toHaveTextContent("Contacto no encontrado.");
  });

  it("cualquier otro error sale con el texto genérico, sin el mensaje interno", () => {
    mockContactQuery = { error: new Error('Failed to fetch ["contacts","detail","cli-1"]') };
    renderPanel();

    const error = screen.getByTestId("contact-filter-error");

    expect(error).toHaveTextContent("No pudimos cargar el reporte.");
    expect(error).not.toHaveTextContent(/Failed to fetch|detail/);
  });

  it("sin red (lectura en pausa) avisa de que no hay conexión", () => {
    mockContactQuery = { isPaused: true };
    renderPanel();

    expect(screen.getByTestId("contact-filter-error")).toHaveTextContent(
      "Sin conexión. Reintentaremos al volver la red.",
    );
  });

  it("sin error no pinta ninguno", () => {
    mockContactQuery = { data: { id: "cli-1", name: "Ana" } };
    renderPanel();

    expect(screen.getByTestId("contact-filter-error")).toBeEmptyDOMElement();
  });
});
