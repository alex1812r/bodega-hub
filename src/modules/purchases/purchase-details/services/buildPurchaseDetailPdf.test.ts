/**
 * @jest-environment node
 */

import type { PurchaseDetails } from "@/modules/purchases/hooks/usePurchases";
import { mockContacts } from "@/shared/mocks/erp-data";

import { buildPurchaseDetailPdfFilename } from "../utils/purchaseDetailPdfFilename";
import { buildPurchaseDetailPdf } from "./buildPurchaseDetailPdf";

const samplePurchase: PurchaseDetails = {
  createdAt: "2026-05-17T16:00:00.000Z",
  discountRef: 0,
  id: "purchase-001",
  items: [
    {
      product: {
        categoryId: "cat-cables",
        currentCostRef: 2,
        currentStock: 10,
        id: "prod-cable",
        isActive: true,
        minStock: 2,
        name: "Cable UTP",
        salePriceRef: 3,
        sku: "CBL-001",
      },
      productId: "prod-cable",
      purchaseId: "purchase-001",
      quantity: 10,
      subtotalRef: 20,
      subtotalVes: 10200,
      unitCostRef: 2,
      unitCostVes: 1020,
    },
  ],
  notes: "Entrega parcial",
  paidVes: 10200,
  payments: [],
  purchaseNumber: "C-000001",
  refRateVes: 510,
  status: "recibido",
  subtotalRef: 20,
  supplier: mockContacts.find((contact) => contact.id === "cont-supplier"),
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 20,
  totalVes: 10200,
  updatedAt: "2026-05-17T18:00:00.000Z",
  userId: "user-warehouse",
};

describe("buildPurchaseDetailPdf", () => {
  it("generates a valid PDF document", () => {
    const pdf = buildPurchaseDetailPdf(samplePurchase, "2026-05-20T12:00:00.000Z");
    const output = pdf.output("arraybuffer");
    const header = String.fromCharCode(...new Uint8Array(output).slice(0, 4));

    expect(header).toBe("%PDF");
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("pairs with purchase filename helper", () => {
    expect(buildPurchaseDetailPdfFilename(samplePurchase.purchaseNumber)).toBe(
      "compra-C-000001.pdf",
    );
  });
});
