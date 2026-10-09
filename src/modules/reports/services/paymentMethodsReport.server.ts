import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { mapPayment, type DbPaymentRow } from "@/lib/supabase/mappers/transactions";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { caracasDateRangeToUtcBounds } from "@/shared/utils/caracasBusinessDay";

import {
  computePaymentMethodsReport,
  resolvePaymentMethodsReportRequest,
  splitPaymentsByPeriod,
  type PaymentMethodsReportResult,
} from "./paymentMethodsReport";
import { fetchAllRows } from "./reportPagination";
import { normalizeStoreIds } from "./storeScope";

export type ReportQueryOptions = {
  useAdmin?: boolean;
};

async function getClient(options?: ReportQueryOptions) {
  return options?.useAdmin ? createAdminSupabaseClient() : await createRouteSupabaseClient();
}

export async function getPaymentMethodsReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
): Promise<PaymentMethodsReportResult> {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const request = resolvePaymentMethodsReportRequest(searchParams);
  const supabase = await getClient(options);
  // Una sola lectura cubre el periodo actual y, si se compara, el anterior.
  const { startUtc, endUtcExclusive } = caracasDateRangeToUtcBounds(
    request.previousRange?.from ?? request.from,
    request.to,
  );

  // Paginado hasta agotar: PostgREST corta cada respuesta en 1.000 filas (D24).
  const rows = await fetchAllRows(
    async (rangeFrom, rangeTo) => {
      let query = supabase
        .from("payments")
        .select(
          "id, amount, amount_ref, amount_ves, contact_id, created_at, direction, method, sale_id, status, store_id",
          { count: "exact" },
        )
        .eq("status", "activo")
        .not("sale_id", "is", null);

      if (storeIds.length === 1) {
        query = query.eq("store_id", storeIds[0]!);
      } else {
        query = query.in("store_id", storeIds);
      }

      if (startUtc) {
        query = query.gte("created_at", startUtc);
      }
      if (endUtcExclusive) {
        query = query.lt("created_at", endUtcExclusive);
      }

      // `id` es único: el orden no cambia entre páginas.
      const { count, data, error, status } = await query
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);

      return { count, data: data as DbPaymentRow[] | null, error, status };
    },
    { getKey: (row) => row.id },
  );

  const { current, previous } = splitPaymentsByPeriod(rows.map(mapPayment), request);

  return computePaymentMethodsReport({
    comparison: request.compare
      ? { payments: previous, previousRange: request.previousRange }
      : undefined,
    payments: current,
    searchParams,
  });
}
