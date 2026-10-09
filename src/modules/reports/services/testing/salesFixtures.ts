/**
 * Ventas, líneas y pagos deterministas para los tests de rangos grandes de
 * Reportes y del dashboard. Los ids tienen la longitud de un uuid (36), que es
 * lo que hace que una lista de ids no quepa en la URL.
 */

export const FIXTURE_STORE_ID = "store-0000-0000-0000-000000000001";
export const FIXTURE_DAY = "2026-05-18";

const DAY_START_UTC_MS = Date.UTC(2026, 4, 18, 4, 0, 0);
const CUSTOMER_COUNT = 3;
const PRODUCT_COUNT = 5;
const METHODS = ["efectivo_usd", "efectivo_ves", "pago_movil"] as const;

function uuid(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export type FixtureSale = {
  created_at: string;
  customer_id: string;
  id: string;
  invoice_number: string;
  paid_ves: number;
  ref_rate_ves: number;
  status: string;
  store_id: string;
  total_ref: number;
  total_ves: number;
};

export type FixtureSaleItem = {
  id: string;
  product_id: string;
  quantity: number;
  sale_id: string;
  subtotal_ref: number;
};

export type FixturePayment = {
  amount: number;
  amount_ref: number;
  amount_ves: number;
  contact_id: string;
  created_at: string;
  direction: string;
  id: string;
  method: string;
  sale_id: string;
  status: string;
  store_id: string;
};

/**
 * `count` ventas de un mismo día operativo (una por segundo), con 2 líneas y
 * 1–2 pagos cada una. Una de cada 10 está cancelada y uno de cada 9 pagos está
 * anulado: no deben contar.
 */
export function buildSalesFixture(count: number) {
  const sales: FixtureSale[] = [];
  const saleItems: FixtureSaleItem[] = [];
  const payments: FixturePayment[] = [];

  for (let index = 0; index < count; index += 1) {
    const saleId = uuid("5a1e0000", index);
    const createdAt = new Date(DAY_START_UTC_MS + index * 1000).toISOString();
    const totalRef = (index % 7) + 1.25;
    const customerId = uuid("c0570000", index % CUSTOMER_COUNT);

    sales.push({
      created_at: createdAt,
      customer_id: customerId,
      id: saleId,
      invoice_number: `F-${String(index).padStart(6, "0")}`,
      paid_ves: index % 4 === 0 ? 0 : totalRef * 500,
      ref_rate_ves: 500,
      status: index % 10 === 9 ? "cancelada" : index % 4 === 0 ? "pendiente_pago" : "pagada",
      store_id: FIXTURE_STORE_ID,
      total_ref: totalRef,
      total_ves: totalRef * 500,
    });

    for (let line = 0; line < 2; line += 1) {
      const quantity = 1 + ((index + line) % 3);

      saleItems.push({
        id: uuid("17e00000", index * 2 + line),
        product_id: uuid("940d0000", (index + line * 2) % PRODUCT_COUNT),
        quantity,
        sale_id: saleId,
        subtotal_ref: quantity * 1.5,
      });
    }

    for (let part = 0; part < 1 + (index % 2); part += 1) {
      const paymentIndex = index * 2 + part;
      const amountRef = Math.round((totalRef / (1 + (index % 2))) * 100) / 100;

      payments.push({
        amount: amountRef * 500,
        amount_ref: amountRef,
        amount_ves: amountRef * 500,
        contact_id: customerId,
        created_at: createdAt,
        direction: "ingreso",
        id: uuid("9a700000", paymentIndex),
        method: METHODS[paymentIndex % METHODS.length]!,
        sale_id: saleId,
        status: paymentIndex % 9 === 8 ? "anulado" : "activo",
        store_id: FIXTURE_STORE_ID,
      });
    }
  }

  const customerIds = [...new Set(sales.map((sale) => sale.customer_id))];
  const productIds = [...new Set(saleItems.map((item) => item.product_id))];

  return {
    contacts: customerIds.map((id, index) => ({ id, name: `Cliente ${index + 1}` })),
    exchange_rates: [
      {
        created_at: "2026-05-18T12:00:00.000Z",
        rate_ves: 520,
        store_id: FIXTURE_STORE_ID,
      },
    ],
    payments,
    products: productIds.map((id, index) => ({
      id,
      name: `Producto ${index + 1}`,
      sku: `SKU-${index + 1}`,
    })),
    sale_items: saleItems,
    sales,
  };
}

export const COUNTED_SALE_STATUSES = ["borrador", "pagada", "pendiente_pago"];
