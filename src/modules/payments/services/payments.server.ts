import { ApiError, type ApiErrorCode } from "@/lib/api/apiError";
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
  created_by_profile:profiles!payments_created_by_fkey(id, full_name),
  sale:sales(id, invoice_number),
  purchase:purchases(id, purchase_number)
`;

export type PaymentUpdateInput = {
  bankName?: string;
  notes?: string;
  phone?: string;
  referenceCode?: string;
};

type PaymentCreatedByProfile = {
  full_name?: string | null;
  id: string;
};

type PaymentRowWithContact = DbPaymentRow & {
  contact?: DbContactRow | null;
  created_by_profile?: PaymentCreatedByProfile | PaymentCreatedByProfile[] | null;
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

function mapCreatedByProfile(
  profile: PaymentCreatedByProfile | PaymentCreatedByProfile[] | null | undefined,
) {
  const row = Array.isArray(profile) ? profile[0] : profile;
  if (!row?.id) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.full_name?.trim() || "Usuario",
  };
}

/**
 * SQLSTATE deliberados de `register_payment` / `cancel_payment`
 * (`supabase/patches/20260904-payment-guards.sql`). La clase `PT` esta
 * reservada para codigos de usuario y PostgREST la interpreta como el status
 * HTTP, asi que basta con leer `error.code`: un mensaje de validacion nuevo ya
 * no puede caer en un 500 por no estar en una lista de substrings.
 */
const RPC_SQLSTATE_MAP: Record<string, { code: ApiErrorCode; status: number }> = {
  PT400: { code: "BAD_REQUEST", status: 400 },
  PT402: { code: "INSUFFICIENT_VAULT_BALANCE", status: 400 },
  PT403: { code: "FORBIDDEN", status: 403 },
  PT404: { code: "NOT_FOUND", status: 404 },
  PT409: { code: "CONFLICT", status: 409 },
};

/**
 * Marcadores de reglas de negocio para los RPC que todavia levantan el `P0001`
 * por defecto (`create_sale`, `create_purchase`, triggers de contacto/tienda).
 * Se comparan sin acentos.
 */
const RPC_BUSINESS_RULE_MARKERS = [
  "debe",
  "requiere",
  "invalid",
  "mayor a cero",
  "no se puede",
  "no puede",
  "no pertenece",
  "ya fue anulado",
  "ya esta",
  "excede",
  "suficiente",
  "solo aplica",
  "desglose de billetes",
  "vuelto",
  "saldo pendiente",
];

function getSupabaseErrorSqlState(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

/** Minusculas y sin acentos: los mensajes del RPC vienen acentuados. */
function normalizeRpcMessage(message: string) {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function throwIfRpcError(error: unknown): void {
  if (!error) {
    return;
  }

  const message = getSupabaseErrorMessage(error);
  const mapped = RPC_SQLSTATE_MAP[getSupabaseErrorSqlState(error) ?? ""];

  if (mapped) {
    throw new ApiError(mapped.status, mapped.code, message);
  }

  const normalized = normalizeRpcMessage(message);

  if (normalized.includes("saldo insuficiente en el baul")) {
    throw new ApiError(400, "INSUFFICIENT_VAULT_BALANCE", message);
  }

  if (normalized.includes("sesion de caja abierta")) {
    throw new ApiError(400, "BAD_REQUEST", message);
  }

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

  if (RPC_BUSINESS_RULE_MARKERS.some((marker) => normalized.includes(marker))) {
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
    createdBy: mapCreatedByProfile(row.created_by_profile),
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
      .select("id, purchase_number, total_ves, total_ref, paid_ves, paid_ref")
      .eq("id", payment.purchase_id)
      .maybeSingle();

    throwIfSupabaseError(error);

    if (!data) {
      return undefined;
    }

    const totalVes = Number(data.total_ves ?? 0);
    const paidVes = Number(data.paid_ves ?? 0);
    const totalRef = Number(data.total_ref ?? 0);
    const paidRef = Number(data.paid_ref ?? 0);

    return {
      href: `/purchases/${data.id}`,
      label: formatPurchaseNumberDisplay(data.purchase_number),
      paidRef,
      paidVes,
      pendingRef: Math.max(Math.round((totalRef - paidRef) * 100) / 100, 0),
      pendingVes: Math.max(totalVes - paidVes, 0),
      totalRef,
      totalVes,
    };
  }

  return undefined;
}

function applyPaymentFilters<T extends {
  eq: (column: string, value: string) => T;
  is: (column: string, value: null) => T;
}>(query: T, searchParams: URLSearchParams, salePaymentsOnly?: boolean) {
  const contactId = searchParams.get("contactId");
  const direction = searchParams.get("direction");
  const purchaseId = searchParams.get("purchaseId");
  const saleId = searchParams.get("saleId");

  let filteredQuery = query;

  if (salePaymentsOnly) {
    filteredQuery = filteredQuery.is("purchase_id", null);
  }

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

export type PaymentAccessOptions = {
  salePaymentsOnly?: boolean;
};

export async function listPayments(
  searchParams: URLSearchParams,
  storeId: string,
  options: PaymentAccessOptions = {},
) {
  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);

  let query = supabase.from("payments").select(PAYMENT_SELECT, { count: "exact" }).eq("store_id", storeId);

  query = applyPaymentFilters(query, searchParams, options.salePaymentsOnly);

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

/**
 * El vuelto es una salida, no un cobro: banco/telefono/referencia son opcionales
 * y se archivan en `notes` porque las columnas de la fila son las del cobro.
 */
function buildPaymentNotes(input: PaymentInput) {
  const change = input.change;
  const notes = input.notes?.trim();

  if (!change?.method || change.amount <= 0) {
    return notes || null;
  }

  const details = [
    change.bankName?.trim() ? `banco ${change.bankName.trim()}` : null,
    change.phone?.trim() ? `telefono ${change.phone.trim()}` : null,
    change.referenceCode?.trim() ? `referencia ${change.referenceCode.trim()}` : null,
  ].filter((detail): detail is string => Boolean(detail));

  if (details.length === 0) {
    return notes || null;
  }

  return [notes, `Vuelto por ${change.method}: ${details.join(", ")}`]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

export async function createPayment(input: PaymentInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const changeAmount = input.change?.method ? Math.max(0, input.change.amount) : 0;
  const { data, error } = await supabase.rpc("register_payment", {
    p_amount: input.amount,
    p_bank_name: input.bankName ?? null,
    p_method: input.method,
    p_notes: buildPaymentNotes(input),
    p_phone: input.phone ?? null,
    p_purchase_id: input.purchaseId ?? null,
    p_reference_code: input.referenceCode ?? null,
    p_sale_id: input.saleId ?? null,
    // Solo se mandan cuando hay algo que registrar: asi un cobro simple sigue
    // resolviendo la firma corta de `register_payment`.
    ...(changeAmount > 0
      ? {
          p_change_amount: changeAmount,
          p_change_method: input.change?.method ?? null,
        }
      : {}),
    ...(input.changeDenominations
      ? { p_change_denominations: input.changeDenominations }
      : {}),
    ...(input.receivedDenominations
      ? { p_received_denominations: input.receivedDenominations }
      : {}),
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
