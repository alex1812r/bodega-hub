import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

import { applyCreatedAtCaracasRange } from "@/shared/utils/caracasBusinessDay";

import {
  computeFxDepreciationReport,
  type FxDepreciationReportResult,
} from "./fxDepreciationReport";
import { fetchAllRows, fetchAllRowsByIds } from "./reportPagination";
import { normalizeStoreIds } from "./storeScope";

export type ReportQueryOptions = {
  useAdmin?: boolean;
};

type DbFxSaleRow = {
  created_at: string;
  id: string;
  invoice_number: string;
  ref_rate_ves: number | string;
  store_id: string;
  total_ref: number | string;
};

type DbFxPaymentRow = {
  amount_ref: number | string;
  amount_ves: number | string;
  id: string;
  method: string;
  sale_id: string;
  store_id: string;
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

  // Paginado hasta agotar: PostgREST corta cada respuesta en 1.000 filas y sin
  // esto solo contaban las 1.000 ventas más recientes del rango.
  const salesData = await fetchAllRows<DbFxSaleRow>(
    async (rangeFrom, rangeTo) => {
      let salesQuery = supabase
        .from("sales")
        .select("id, invoice_number, created_at, ref_rate_ves, total_ref, store_id, status", {
          count: "exact",
        })
        .neq("status", "cancelada");
      salesQuery = applyStoreIdsFilter(salesQuery, storeIds);
      salesQuery = applyCreatedAtRange(salesQuery, from, to);

      // El orden de siempre (más recientes primero) con `id` (único) de
      // desempate: no cambia entre páginas.
      const { count, data, error, status } = await salesQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);

      return { count, data: data as DbFxSaleRow[] | null, error, status };
    },
    { getKey: (row) => row.id },
  );

  const sales = salesData.map((row) => ({
    createdAt: row.created_at,
    id: row.id,
    invoiceNumber: row.invoice_number,
    refRateVes: Number(row.ref_rate_ves),
    storeId: row.store_id,
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
    // Los ids se piden por lotes: todos en una URL dan "URI too long" con ~220 ventas.
    const paymentsData = await fetchAllRowsByIds<DbFxPaymentRow>(
      saleIds,
      async (saleIdChunk, rangeFrom, rangeTo) => {
        let paymentsQuery = supabase
          .from("payments")
          .select("id, sale_id, method, amount_ves, amount_ref, store_id, status", {
            count: "exact",
          })
          .eq("status", "activo")
          .not("sale_id", "is", null);
        if (storeIds.length === 1) {
          paymentsQuery = paymentsQuery.eq("store_id", storeIds[0]!);
        } else {
          paymentsQuery = paymentsQuery.in("store_id", storeIds);
        }

        // `id` es único: el orden no cambia entre páginas.
        const { count, data, error, status } = await paymentsQuery
          .in("sale_id", saleIdChunk)
          .order("id", { ascending: true })
          .range(rangeFrom, rangeTo);

        return { count, data: data as DbFxPaymentRow[] | null, error, status };
      },
      { getKey: (row) => row.id },
    );

    payments = paymentsData.map((row) => ({
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
