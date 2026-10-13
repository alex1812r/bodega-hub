import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import { exportMovementsToExcel } from "../services/exportMovementsExcel";
import { InventoryMovementsExportActions } from "./InventoryMovementsExportActions";

jest.mock("../services/exportMovementsExcel", () => ({
  exportMovementsToExcel: jest.fn(),
}));

const exportMock = jest.mocked(exportMovementsToExcel);
const LIMIT_NOTICE =
  "Se exportaron los 20.000 movimientos más recientes de 100.250. Acota el rango de fechas para exportar el resto.";

/** INV-F5 · M2: si la exportación se cortó en el tope, el usuario lo ve. */
describe("InventoryMovementsExportActions · aviso de tope (INV-F5 · M2)", () => {
  beforeEach(() => {
    exportMock.mockReset();
  });

  it("muestra el aviso cuando el Excel salió cortado y lo quita en la siguiente exportación", async () => {
    exportMock.mockResolvedValueOnce(LIMIT_NOTICE).mockResolvedValueOnce(null);

    render(<InventoryMovementsExportActions exportFilters={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));

    expect(await screen.findByRole("status")).toHaveTextContent(LIMIT_NOTICE);

    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));

    await screen.findByRole("button", { name: "Exportar Excel" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("una exportación completa no muestra ningún aviso", async () => {
    exportMock.mockResolvedValueOnce(null);

    render(<InventoryMovementsExportActions exportFilters={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));

    await screen.findByRole("button", { name: "Exportar Excel" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
