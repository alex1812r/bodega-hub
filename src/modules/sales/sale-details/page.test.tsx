/**
 * STK-607 · el rechazo de una accion del detalle (anular / devolver) debe quedar
 * a la vista en el momento del fallo: junto a la cabecera, que es donde esta el
 * menu «Acciones», y no al final de la pagina (bajo el pliegue).
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));

// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aqui.
jest.mock("./services/exportSaleInvoicePdf", () => ({
  exportSaleInvoicePdf: jest.fn(),
}));

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import type { SaleDetail } from "../hooks/useSales";
import { SaleDetailsPage } from "./page";

const PAID_SALE: SaleDetail = {
  createdAt: "2026-10-06T13:32:00.000Z",
  customerId: "cont-customer",
  discountRef: 0,
  id: "sale-stk607",
  invoiceNumber: "V-20261006-000013",
  items: [],
  paidVes: 2617.18,
  payments: [],
  refRateVes: 872.39,
  status: "pagada",
  subtotalRef: 3,
  taxRef: 0,
  totalRef: 3,
  totalVes: 2617.18,
  userId: "user-seller",
};

const CANCEL_REJECTION =
  "La venta V-20261006-000013 tiene 1 pago(s) activo(s) por Bs 2617.18. Anula primero los pagos y luego cancela la venta.";
const RETURN_REJECTION = "La venta V-20261006-000013 ya no tiene unidades por devolver.";

function installSaleApi() {
  const mutations: Array<{ method: string; url: string }> = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET") {
      return Promise.resolve(
        jsonResponse({ data: url === `/api/sales/${PAID_SALE.id}` ? PAID_SALE : {} }),
      );
    }

    mutations.push({ method, url });

    return Promise.resolve(
      jsonResponse(
        {
          error: {
            code: "CONFLICT",
            message: url.endsWith("/cancel") ? CANCEL_REJECTION : RETURN_REJECTION,
          },
        },
        409,
      ),
    );
  }) as unknown as typeof fetch;

  return mutations;
}

async function confirmAction(menuItem: string, confirmLabel: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Acciones de la venta" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: menuItem }));
  fireEvent.click(await screen.findByRole("button", { name: confirmLabel }));
}

/** El aviso va despues de la cabecera y antes de cualquier tarjeta del detalle. */
function expectRightBelowHeader(message: HTMLElement) {
  const header = screen.getByRole("heading", { level: 1 });
  const firstCard = screen.getByText("Historial de Pagos");

  expect(header.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(message.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    message.compareDocumentPosition(screen.getByText("Total (VES)")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

describe("SaleDetailsPage · errores de las acciones (STK-607)", () => {
  it("anular una venta pagada: el 409 se muestra junto a la cabecera, no al final", async () => {
    const mutations = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await confirmAction("Anular venta", "Anular venta");

    const message = await screen.findByText(CANCEL_REJECTION);

    expect(mutations).toEqual([{ method: "PATCH", url: `/api/sales/${PAID_SALE.id}/cancel` }]);
    expect(screen.getByText("No pudimos actualizar la venta")).toBeInTheDocument();
    expect(screen.getByText("Pagada")).toBeInTheDocument();
    expectRightBelowHeader(message);
  });

  it("devolucion rechazada: mismo aviso, mismo sitio", async () => {
    const mutations = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await confirmAction("Devolucion", "Registrar devolucion");

    const message = await screen.findByText(RETURN_REJECTION);

    expect(mutations).toEqual([{ method: "POST", url: `/api/sales/${PAID_SALE.id}/return` }]);
    expectRightBelowHeader(message);
  });
});
