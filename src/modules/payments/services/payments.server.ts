import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { getSupabaseErrorMessage, mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapContact, type DbContactRow } from "@/lib/supabase/mappers/contacts";
import { mapPayment, type DbPaymentRow } from "@/lib/supabase/mappers/transactions";
import { getPaginationRange, toPaginatedList } from "@/lib/supabase/pagination";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";
import type { PaymentDocumentBalance } from "../payment-details/types";
import type { PaymentRelatedDocument } from "../utils/resolvePaymentRelatedDocument";
import type { PaymentInput } from "./payments.mock-server";

const PAYMENT_SELECT = `
  *,
  contact:contacts(id, type, name, tax_id, email, phone, address, is_active, created_at, updated_at),
  sale:sales(id, invoice_number),
  purchase:purchases(id, purchase_number)
`;

export type PaymentUpdateInput = {
  bankName?: string;
  notes?: string;
  phone?: string;
  referenceCode?: string;
};

type PaymentRowWithContact = DbPaymentRow & {
  contact?: DbContactRow | null;
  purchase?: { id: string; purchase_number: string } | null;
  sale?: { id: string; invoice_number: string } | null;
};

function mapPaymentRelatedDocument(row: PaymentRowWithContact): PaymentRelatedDocument | undefined {
  if (row.sale?.id && row.sale.invoice_number) {
    return {
      href: `/sales/${row.sale.id}`,
      label: row.sale.invoice_number,
    };
  }

  if (row.purchase?.id && row.purchase.purchase_number) {
    return {
      href: `/purchases/${row.purchase.id}`,
      label: formatPurchaseNumberDisplay(row.purchase.purchase_number),
    };
  }

  return undefined;
}

function throwIfRpcError(error: unknown): void {
  if (!error) {
    return;
  }

  const message = getSupabaseErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("no encontrad") || normalized.includes("not found")) {
    throw new ApiError(404, "NOT_FOUND", message);
  }

  if (
    normalized.includes("no autorizado") ||
    normalized.includes("not authorized") ||
    normalized.includes("permission denied")
  ) {
    throw new ApiError(403, "FORBIDDEN", message);
  }

  if (
    normalized.includes("debe") ||
    normalized.includes("requiere") ||
    normalized.includes("invalid") ||
    normalized.includes("mayor a cero")
  ) {
    throw new ApiError(400, "BAD_REQUEST", message);
  }

  throw mapSupabaseError(error);
}

function mapPaymentWithContact(
  row: PaymentRowWithContact,
  documentBalance?: PaymentDocumentBalance,
) {
  return {
    ...mapPayment(row),
    contact: row.contact ? mapContact(row.contact) : undefined,
    relatedDocument: mapPaymentRelatedDocument(row),
    ...(documentBalance
      ? {
          documentBalance,
          pendingBalanceVes: documentBalance.pendingVes,
        }
      : {}),
  };
}

async function resolveDocumentBalance(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  payment: DbPaymentRow,
): Promise<PaymentDocumentBalance | undefined> {
  if (payment.sale_id) {
    const { data, error } = await supabase
      .from("sales")
      .select("id, invoice_number, total_ves, paid_ves")
      .eq("id", payment.sale_id)
      .maybeSingle();

    throwIfSupabaseError(error);

    if (!data) {
      return undefined;
    }

    const totalVes = Number(data.total_ves ?? 0);
    const paidVes = Number(data.paid_ves ?? 0);

    return {
      href: `/sales/${data.id}`,
      label: data.invoice_number,
      paidVes,
      pendingVes: Math.max(totalVes - paidVes, 0),
      totalVes,
    };
  }

  if (payment.purchase_id) {
    const { data, error } = await supabase
      .from("purchases")
      .select("id, purchase_number, total_ves, paid_ves")
      .eq("id", payment.purchase_id)
      .maybeSingle();

    throwIfSupabaseError(error);

    if (!data) {
      return undefined;
    }

    const totalVes = Number(data.total_ves ?? 0);
    const paidVes = Number(data.paid_ves ?? 0);

    return {
      href: `/purchases/${data.id}`,
      label: formatPurchaseNumberDisplay(data.purchase_number),
      paidVes,
      pendingVes: Math.max(totalVes - paidVes, 0),
      totalVes,
    };
  }

  return undefined;
}

function applyPaymentFilters<T extends {
  eq: (column: string, value: string) => T;
}>(query: T, searchParams: URLSearchParams) {
  const contactId = searchParams.get("contactId");
  const direction = searchParams.get("direction");
  const purchaseId = searchParams.get("purchaseId");
  const saleId = searchParams.get("saleId");

  let filteredQuery = query;

  if (direction) {
    filteredQuery = filteredQuery.eq("direction", direction);
  }

  if (saleId) {
    filteredQuery = filteredQuery.eq("sale_id", saleId);
  }

  if (purchaseId) {
    filteredQuery = filteredQuery.eq("purchase_id", purchaseId);
  }

  if (contactId) {
    filteredQuery = filteredQuery.eq("contact_id", contactId);
  }

  return filteredQuery;
}

export async function listPayments(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);

  let query = supabase.from("payments").select(PAYMENT_SELECT, { count: "exact" }).eq("store_id", storeId);

  query = applyPaymentFilters(query, searchParams);

  const result = await query.order("created_at", { ascending: false }).range(skip, to);

  return toPaginatedList(searchParams, result as { count: number | null; data: PaymentRowWithContact[] | null; error: unknown }, (row) =>
    mapPaymentWithContact(row),
  );
}

export async function getPaymentById(id: string, storeId: string) {
  await assertSupabaseStoreResource("payments", id, storeId, "Pago no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("id", id)
    .maybeSingle<PaymentRowWithContact>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Pago no encontrado.");
  }

  const documentBalance = await resolveDocumentBalance(supabase, data);

  return mapPaymentWithContact(data, documentBalance);
}

export async function createPayment(input: PaymentInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("register_payment", {
    p_amount: input.amount,
    p_bank_name: input.bankName ?? null,
    p_method: input.method,
    p_notes: input.notes ?? null,
    p_phone: input.phone ?? null,
    p_purchase_id: input.purchaseId ?? null,
    p_reference_code: input.referenceCode ?? null,
    p_sale_id: input.saleId ?? null,
  });

  throwIfRpcError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el pago.");
  }

  const documentBalance = await resolveDocumentBalance(supabase, data as DbPaymentRow);

  return mapPaymentWithContact(data as PaymentRowWithContact, documentBalance);
}

export async function updatePayment(id: string, input: PaymentUpdateInput, storeId: string) {
  await assertSupabaseStoreResource("payments", id, storeId, "Pago no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .update({
      ...(input.bankName !== undefined ? { bank_name: input.bankName || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.referenceCode !== undefined ? { reference_code: input.referenceCode || null } : {}),
    })
    .eq("id", id)
    .select(PAYMENT_SELECT)
    .maybeSingle<PaymentRowWithContact>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Pago no encontrado.");
  }

  const documentBalance = await resolveDocumentBalance(supabase, data);

  return mapPaymentWithContact(data, documentBalance);
}

export async function cancelPayment(id: string, storeId: string) {
  await assertSupabaseStoreResource("payments", id, storeId, "Pago no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_payment", {
    p_payment_id: id,
  });

  throwIfRpcError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Pago no encontrado.");
  }

  const documentBalance = await resolveDocumentBalance(supabase, data as DbPaymentRow);

  return mapPaymentWithContact(data as PaymentRowWithContact, documentBalance);
}
