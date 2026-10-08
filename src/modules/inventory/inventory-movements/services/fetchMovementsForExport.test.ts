/**
 * @jest-environment node
 */

import { fetchExportRows } from "../../services/fetchExportRows";
import { describeMovementsExportLimit, fetchMovementsForExport } from "./fetchMovementsForExport";

jest.mock("../../services/fetchExportRows", () => ({
  ...jest.requireActual("../../services/fetchExportRows"),
  fetchExportRows: jest.fn(),
}));

const fetchExportRowsMock = jest.mocked(fetchExportRows);
const empty = { rows: [], total: 0, truncated: false };

describe("fetchMovementsForExport", () => {
  beforeEach(() => {
    fetchExportRowsMock.mockReset();
  });

  it("passes active list filters to the movements API", async () => {
    fetchExportRowsMock.mockResolvedValue(empty);

    await fetchMovementsForExport({
      document: "C-00",
      documentKind: "compra",
      from: "2026-05-01",
      productId: "prod-cable",
      to: "2026-05-18",
      type: "compra",
    });

    expect(fetchExportRowsMock).toHaveBeenCalledWith("/api/inventory/movements", {
      document: "C-00",
      documentKind: "compra",
      from: "2026-05-01",
      productId: "prod-cable",
      to: "2026-05-18",
      type: "compra",
    });
  });

  it("asks for the movements without a document when that is the filter", async () => {
    fetchExportRowsMock.mockResolvedValue(empty);

    await fetchMovementsForExport({ documentKind: "sin_documento" });

    expect(fetchExportRowsMock).toHaveBeenCalledWith(
      "/api/inventory/movements",
      expect.objectContaining({ document: undefined, documentKind: "sin_documento" }),
    );
  });
});

describe("describeMovementsExportLimit (INV-F5 · M2)", () => {
  it("avisa de cuántos movimientos salieron cuando la exportación se cortó en el tope", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) => ({
      createdAt: "2026-10-05T16:00:00.000Z",
      id: `mov-${index}`,
      productId: "prod-cable",
      quantityDelta: 1,
      stockAfter: 1,
      type: "ajuste_entrada" as const,
    }));

    expect(describeMovementsExportLimit({ rows, total: 100_250, truncated: true })).toBe(
      "Se exportaron los 20.000 movimientos más recientes de 100.250. Acota el rango de fechas para exportar el resto.",
    );
  });

  it("no avisa cuando salió la lista entera", () => {
    expect(describeMovementsExportLimit(empty)).toBeNull();
  });
});
