import { mapBaseEntity } from "@/lib/supabase/mappers/base";
import { mapProductSummary, type DbProductSummaryRow } from "@/lib/supabase/mappers/products";
import type {
  PaymentDirection,
  PaymentMethod,
  PurchaseStatus,
  SaleStatus,
  StockMovementType,
} from "@/shared/mocks/erp-data";

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type DbSaleRow = {
  created_at?: string | null;
  customer_id: string;
  discount_ref?: number | string | null;
  id: string;
  invoice_number: string;
  paid_ves?: number | string | null;
  ref_rate_ves?: number | string | null;
  status: SaleStatus;
  subtotal_ref?: number | string | null;
  tax_ref?: number | string | null;
  total_ref?: number | string | null;
  total_ves?: number | string | null;
  updated_at?: string | null;
  user_id?: string | null;
};

export type DbPurchaseRow = {
  created_at?: string | null;
  discount_ref?: number | string | null;
  id: string;
  paid_ves?: number | string | null;
  purchase_number: string;
  ref_rate_ves?: number | string | null;
  status: PurchaseStatus;
  subtotal_ref?: number | string | null;
  supplier_id: string;
  tax_ref?: number | string | null;
  total_ref?: number | string | null;
  total_ves?: number | string | null;
  updated_at?: string | null;
  user_id?: string | null;
};

export type DbPaymentRow = {
  amount?: number | string | null;
  amount_ref?: number | string | null;
  amount_ves?: number | string | null;
  bank_name?: string | null;
  contact_id: string;
  created_at?: string | null;
  currency?: "USD" | "VES" | null;
  direction: PaymentDirection;
  id: string;
  method: PaymentMethod;
  notes?: string | null;
  phone?: string | null;
  purchase_id?: string | null;
  reference_code?: string | null;
  ref_rate_ves?: number | string | null;
  sale_id?: string | null;
};

export function mapSale(row: DbSaleRow) {
  return {
    ...mapBaseEntity(row),
    createdAt: row.created_at ?? "",
    customerId: row.customer_id,
    discountRef: toNumber(row.discount_ref),
    invoiceNumber: row.invoice_number,
    paidVes: toNumber(row.paid_ves),
    refRateVes: toNumber(row.ref_rate_ves),
    status: row.status,
    subtotalRef: toNumber(row.subtotal_ref),
    taxRef: toNumber(row.tax_ref),
    totalRef: toNumber(row.total_ref),
    totalVes: toNumber(row.total_ves),
    userId: row.user_id ?? "",
  };
}

export function mapPurchase(row: DbPurchaseRow) {
  return {
    ...mapBaseEntity(row),
    createdAt: row.created_at ?? "",
    discountRef: toNumber(row.discount_ref),
    paidVes: toNumber(row.paid_ves),
    purchaseNumber: row.purchase_number,
    refRateVes: toNumber(row.ref_rate_ves),
    status: row.status,
    subtotalRef: toNumber(row.subtotal_ref),
    supplierId: row.supplier_id,
    taxRef: toNumber(row.tax_ref),
    totalRef: toNumber(row.total_ref),
    totalVes: toNumber(row.total_ves),
    userId: row.user_id ?? "",
  };
}

export function mapPayment(row: DbPaymentRow) {
  return {
    amount: toNumber(row.amount),
    amountRef: toNumber(row.amount_ref),
    amountVes: toNumber(row.amount_ves),
    bankName: row.bank_name ?? undefined,
    contactId: row.contact_id,
    createdAt: row.created_at ?? "",
    currency: row.currency ?? undefined,
    direction: row.direction,
    id: row.id,
    method: row.method,
    notes: row.notes ?? undefined,
    phone: row.phone ?? undefined,
    purchaseId: row.purchase_id ?? undefined,
    referenceCode: row.reference_code ?? undefined,
    refRateVes: toNumber(row.ref_rate_ves),
    saleId: row.sale_id ?? undefined,
  };
}

export type DbPurchaseItemRow = {
  product?: DbProductSummaryRow | null;
  product_id: string;
  purchase_id: string;
  quantity: number;
  subtotal_ref?: number | string | null;
  subtotal_ves?: number | string | null;
  unit_cost_ref?: number | string | null;
  unit_cost_ves?: number | string | null;
};

export type DbStockMovementRow = {
  created_at?: string | null;
  id: string;
  product?: DbProductSummaryRow | DbProductSummaryRow[] | null;
  product_id: string;
  purchase_id?: string | null;
  quantity_delta: number;
  reason?: string | null;
  sale_id?: string | null;
  stock_after?: number | null;
  type: StockMovementType;
};

function resolveEmbeddedProduct(
  product: DbProductSummaryRow | DbProductSummaryRow[] | null | undefined,
) {
  if (!product) {
    return undefined;
  }

  return Array.isArray(product) ? product[0] : product;
}

export function mapPurchaseItem(row: DbPurchaseItemRow) {
  return {
    product: row.product ? mapProductSummary(row.product) : undefined,
    productId: row.product_id,
    purchaseId: row.purchase_id,
    quantity: row.quantity,
    subtotalRef: toNumber(row.subtotal_ref),
    subtotalVes: toNumber(row.subtotal_ves),
    unitCostRef: toNumber(row.unit_cost_ref),
    unitCostVes: toNumber(row.unit_cost_ves),
  };
}

export function mapStockMovement(row: DbStockMovementRow) {
  const product = resolveEmbeddedProduct(row.product);

  return {
    createdAt: row.created_at ?? "",
    id: row.id,
    productId: row.product_id,
    purchaseId: row.purchase_id ?? undefined,
    quantityDelta: row.quantity_delta,
    reason: row.reason ?? undefined,
    saleId: row.sale_id ?? undefined,
    stockAfter: row.stock_after ?? 0,
    type: row.type,
    ...(product ? { product: mapProductSummary(product) } : {}),
  };
}

export function mapContactActivityItem(
  row: { amountVes: number; createdAt: string; id: string; type: "payment" | "purchase" | "sale" },
) {
  return row;
}
