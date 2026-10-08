/**
 * @jest-environment node
 */

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import { fetchPaymentsForExport } from "./fetchPaymentsForExport";

jest.mock("../../../lib/api/fetchAllPaginatedItems", () => ({
  fetchAllPaginatedItems: jest.fn(),
}));

const fetchAllPaginatedItemsMock = fetchAllPaginatedItems as jest.MockedFunction<
  typeof fetchAllPaginatedItems
>;

describe("fetchPaymentsForExport", () => {
  beforeEach(() => {
    fetchAllPaginatedItemsMock.mockReset();
  });

  it("requests all paginated payments with active list filters", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchPaymentsForExport({
      contactId: "cont-customer",
      direction: "entrada",
      purchaseId: "purchase-001",
      saleId: "sale-002",
    });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith("/api/payments", {
      contactId: "cont-customer",
      direction: "entrada",
      purchaseId: "purchase-001",
      saleId: "sale-002",
    });
  });

  it("PAG-05: la exportacion respeta el metodo y el rango de fechas de la lista", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchPaymentsForExport({
      direction: "entrada",
      from: "2026-10-01",
      method: "pago_movil",
      to: "2026-10-06",
    });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith(
      "/api/payments",
      expect.objectContaining({
        direction: "entrada",
        from: "2026-10-01",
        method: "pago_movil",
        to: "2026-10-06",
      }),
    );
  });

  it("no envia a la API nada que no sea un filtro de la lista (pagina, tamaño)", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchPaymentsForExport({ limit: 25, method: "efectivo_usd", skip: 50 } as never);

    expect(Object.keys(fetchAllPaginatedItemsMock.mock.calls[0][1] ?? {}).sort()).toEqual([
      "contactId",
      "direction",
      "from",
      "method",
      "purchaseId",
      "saleId",
      "to",
    ]);
  });
});
