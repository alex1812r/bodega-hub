/**
 * DET-F2 · el detalle de compra recuerda el scroll por URL y lo restaura al
 * volver, con la compra ya pintada.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const DETAIL_SEARCH = "returnTo=%2Fcontacts%2Fcont-supplier%3Ftab%3Dcompras";
const DETAIL_URL = `/purchases/purchase-f2?${DETAIL_SEARCH}`;

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-f2",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aquí.
jest.mock("./services/exportPurchaseDetailPdf", () => ({
  exportPurchaseDetailPdf: jest.fn(),
}));
jest.mock("../../products/components/price-review/PurchaseRepriceNotice", () => ({
  PurchaseRepriceNotice: () => null,
}));

import {
  createQueryWrapper,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

import type { PurchaseDetails } from "../hooks/usePurchases";
import { PurchaseDetailsPage } from "./page";

const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-06T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-f2",
  items: [],
  paidRef: 40,
  paidVes: 20000,
  payments: [],
  purchaseNumber: "C-20261006-000007",
  refRateVes: 500,
  status: "recibido",
  subtotalRef: 40,
  supplier: { id: "cont-supplier", name: "Distribuidora Polar" } as PurchaseDetails["supplier"],
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 40,
  totalVes: 20000,
  userId: "user-admin",
};

function stored() {
  return JSON.parse(window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY) ?? "[]");
}

describe("PurchaseDetailsPage · scroll al volver (DET-F2)", () => {
  const originalScrollTo = window.scrollTo;
  /** Cada restauración: a qué posición y si la compra ya estaba pintada. */
  let restores: { painted: boolean; top: number }[];

  beforeEach(() => {
    restores = [];
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, "", DETAIL_URL);
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: (_x: number, top: number) => {
        restores.push({
          painted: screen.queryByRole("heading", { name: /C-20261006-000007/ }) !== null,
          top,
        });
      },
    });
    global.fetch = jest.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse({ data: String(input) === `/api/purchases/${PURCHASE.id}` ? PURCHASE : null }),
      ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("restaura la posición guardada para la URL del detalle con la compra ya pintada", async () => {
    window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify([[DETAIL_URL, 640]]));

    render(<PurchaseDetailsPage purchaseId={PURCHASE.id} />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(restores).toEqual([{ painted: true, top: 640 }]));
  });

  it("al salir guarda la posición bajo la URL del detalle", async () => {
    const view = render(<PurchaseDetailsPage purchaseId={PURCHASE.id} />, {
      wrapper: createQueryWrapper(),
    });

    await screen.findByRole("heading", { name: /C-20261006-000007/ });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 380 });
    fireEvent.scroll(window);
    view.unmount();

    expect(stored()).toEqual([[DETAIL_URL, 380]]);
  });
});
