import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

import { applyCreatedAtCaracasRange } from "@/shared/utils/caracasBusinessDay";

import {
  computeFxDepreciationReport,
  type FxDepreciationReportResult,
} from "./fxDepreciationReport";
import { normalizeStoreIds } from "./storeScope";

export type ReportQueryOptions = {
  useAdmin?: boolean;
};

async function getClient(options?: ReportQueryOptions) {
  return options?.useAdmin ? createAdminSupabaseClient() : await createRouteSupabaseClient();
}

function applyCreatedAtRange<
  T extends { gte: (col: string, val: string) => T; lt: (col: string, val: string) => T },
>(query: T, from: string | null, to: string | null) {
  return applyCreatedAtCaracasRange(query, from, to);
}

function applyStoreIdsFilter<
  T extends {
    eq: (col: string, val: string) => T;
    in: (col: string, vals: string[]) => T;
  },
>(query: T, storeIds: string[]) {
  if (storeIds.length === 1) {
    return query.eq("store_id", storeIds[0]!);
  }

  return query.in("store_id", storeIds);
}

export async function getFxDepreciationReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
): Promise<FxDepreciationReportResult> {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await getClient(options);

  let salesQuery = supabase
    .from("sales")
    .select("id, invoice_number, created_at, ref_rate_ves, total_ref, store_id, status")
    .neq("status", "cancelada");
  salesQuery = applyStoreIdsFilter(salesQuery, storeIds);
  salesQuery = applyCreatedAtRange(salesQuery, from, to);
  salesQuery = salesQuery.order("created_at", { ascending: false });

  const { data: salesData, error: salesError } = await salesQuery;
  throwIfSupabaseError(salesError);

  const sales = (salesData ?? []).map((row) => ({
    createdAt: row.created_at as string,
    id: row.id as string,
    invoiceNumber: row.invoice_number as string,
    refRateVes: Number(row.ref_rate_ves),
    storeId: row.store_id as string,
    totalRef: Number(row.total_ref),
  }));

  const saleIds = sales.map((sale) => sale.id);
  let payments: Array<{
    amountRef: number;
    amountVes: number;
    method: string;
    saleId: string;
    storeId: string;
  }> = [];

  if (saleIds.length > 0) {
    let paymentsQuery = supabase
      .from("payments")
      .select("sale_id, method, amount_ves, amount_ref, store_id, status")
      .eq("status", "activo")
      .not("sale_id", "is", null);
    if (storeIds.length === 1) {
      paymentsQuery = paymentsQuery.eq("store_id", storeIds[0]!);
    } else {
      paymentsQuery = paymentsQuery.in("store_id", storeIds);
    }
    const { data: paymentsData, error: paymentsError } = await paymentsQuery.in(
      "sale_id",
      saleIds,
    );
    throwIfSupabaseError(paymentsError);

    payments = (paymentsData ?? []).map((row) => ({
      amountRef: Number(row.amount_ref),
      amountVes: Number(row.amount_ves),
      method: row.method as string,
      saleId: row.sale_id as string,
      storeId: row.store_id as string,
    }));
  }

  const valuationRatesByStore: Record<string, { createdAt: string | null; rateVes: number }> =
    {};

  for (const storeId of storeIds) {
    const { data: rateRow, error: rateError } = await supabase
      .from("exchange_rates")
      .select("rate_ves, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfSupabaseError(rateError);

    valuationRatesByStore[storeId] = {
      createdAt: (rateRow?.created_at as string | undefined) ?? null,
      rateVes: rateRow ? Number(rateRow.rate_ves) : 0,
    };
  }

  return computeFxDepreciationReport({
    payments,
    sales,
    searchParams,
    valuationRatesByStore,
  });
}
