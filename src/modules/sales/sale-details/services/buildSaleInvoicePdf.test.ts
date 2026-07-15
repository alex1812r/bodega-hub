/**
 * @jest-environment node
 */

import type { SaleDetail } from "../../hooks/useSales";
import { buildSaleInvoiceFilename } from "../utils/buildSaleInvoiceFilename";
import { buildSaleInvoicePdf } from "./buildSaleInvoicePdf";

const sampleSale: SaleDetail = {
  createdAt: "2026-05-20T14:30:00.000Z",
  customer: {
    address: "Caracas",
    email: "cliente@example.com",
    id: "contact-001",
    isActive: true,
    name: "Cliente Demo",
    phone: "0414-0000000",
    taxId: "J-00000001-1",
    type: "cliente",
  },
  customerId: "contact-001",
  discountRef: 0,
  id: "sale-001",
  invoiceNumber: "V-000001",
  items: [
    {
      product: {
        categoryId: "category-001",
        currentCostRef: 5,
        currentStock: 100,
        id: "product-001",
        isActive: true,
        minStock: 5,
        name: "Producto Demo",
        salePriceRef: 10,
        sku: "SKU-001",
      },
      productId: "product-001",
      quantity: 2,
      saleId: "sale-001",
      subtotalRef: 20,
      subtotalVes: 10200,
      unitCostRefSnapshot: 5,
      unitPriceRef: 10,
    },
  ],
  paidVes: 5000,
  payments: [],
  refRateVes: 510,
  status: "pendiente_pago",
  subtotalRef: 20,
  taxRef: 3.2,
  totalRef: 23.2,
  totalVes: 11832,
  userId: "user-001",
};

describe("buildSaleInvoicePdf", () => {
  it("generates a valid PDF document", () => {
    const pdf = buildSaleInvoicePdf({
      cashierName: "Cajero Demo",
      companyName: "BodegaSync S.A.",
      generatedAt: "2026-05-20T12:00:00.000Z",
      sale: sampleSale,
    });

    const output = pdf.output("arraybuffer");
    const header = String.fromCharCode(...new Uint8Array(output).slice(0, 4));

    expect(header).toBe("%PDF");
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(pdf.internal.pageSize.getWidth()).toBe(80);
  });
});

describe("buildSaleInvoiceFilename", () => {
  it("builds a sanitized filename from the invoice number", () => {
    expect(buildSaleInvoiceFilename("V-000001")).toBe("factura-V-000001.pdf");
    expect(buildSaleInvoiceFilename("#V-000002")).toBe("factura-V-000002.pdf");
  });

  it("falls back when the invoice number is empty after sanitization", () => {
    expect(buildSaleInvoiceFilename("###")).toBe("factura-venta.pdf");
  });
});
