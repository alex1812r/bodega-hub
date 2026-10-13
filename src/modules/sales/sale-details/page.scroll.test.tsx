/**
 * DET-F2 · el detalle de venta recuerda el scroll por URL y lo restaura al
 * volver, con la venta ya pintada.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const DETAIL_SEARCH = "returnTo=%2Fcontacts%2Fcont-customer%3Ftab%3Dpagos";
const DETAIL_URL = `/sales/sale-f2?${DETAIL_SEARCH}`;

jest.mock("next/navigation", () => ({
  usePathname: () => "/sales/sale-f2",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));
// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aquí.
jest.mock("./services/exportSaleInvoicePdf", () => ({
  exportSaleInvoicePdf: jest.fn(),
}));

import {
  createQueryWrapper,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

import type { SaleDetail } from "../hooks/useSales";
import { SaleDetailsPage } from "./page";

const SALE: SaleDetail = {
  createdAt: "2026-10-06T13:32:00.000Z",
  customerId: "cont-customer",
  discountRef: 0,
  id: "sale-f2",
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

function stored() {
  return JSON.parse(window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY) ?? "[]");
}

describe("SaleDetailsPage · scroll al volver (DET-F2)", () => {
  const originalScrollTo = window.scrollTo;
  /** Cada restauración: a qué posición y si la venta ya estaba pintada. */
  let restores: { painted: boolean; top: number }[];

  beforeEach(() => {
    restores = [];
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, "", DETAIL_URL);
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: (_x: number, top: number) => {
        restores.push({ painted: screen.queryByRole("heading", { level: 1 }) !== null, top });
      },
    });
    global.fetch = jest.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse({ data: String(input) === `/api/sales/${SALE.id}` ? SALE : {} }),
      ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("restaura la posición guardada para la URL del detalle con la venta ya pintada", async () => {
    window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify([[DETAIL_URL, 640]]));

    render(<SaleDetailsPage saleId={SALE.id} />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(restores).toEqual([{ painted: true, top: 640 }]));
  });

  it("al salir guarda la posición bajo la URL del detalle", async () => {
    const view = render(<SaleDetailsPage saleId={SALE.id} />, { wrapper: createQueryWrapper() });

    await screen.findByRole("heading", { level: 1 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 380 });
    fireEvent.scroll(window);
    view.unmount();

    expect(stored()).toEqual([[DETAIL_URL, 380]]);
  });
});
