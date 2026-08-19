import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapPayment, type DbPaymentRow } from "@/lib/supabase/mappers/transactions";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { caracasDateRangeToUtcBounds } from "@/shared/utils/caracasBusinessDay";
import { parseDashboardMetricsDateParams } from "@/modules/dashboard/utils/kpiPeriod";

import {
  computePaymentMethodsReport,
  type PaymentMethodsReportResult,
} from "./paymentMethodsReport";
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
  const { from, to } = parseDashboardMetricsDateParams(searchParams);
  const supabase = await getClient(options);

  let query = supabase
    .from("payments")
    .select(
      "id, amount, amount_ref, amount_ves, contact_id, created_at, direction, method, sale_id, status, store_id",
    )
    .eq("status", "activo")
    .not("sale_id", "is", null);

  if (storeIds.length === 1) {
    query = query.eq("store_id", storeIds[0]!);
  } else {
    query = query.in("store_id", storeIds);
  }

  const { startUtc, endUtcExclusive } = caracasDateRangeToUtcBounds(from, to);
  if (startUtc) {
    query = query.gte("created_at", startUtc);
  }
  if (endUtcExclusive) {
    query = query.lt("created_at", endUtcExclusive);
  }

  const { data, error } = await query;
  throwIfSupabaseError(error);

  const payments = (data ?? []).map((row) => mapPayment(row as DbPaymentRow));

  return computePaymentMethodsReport({
    payments,
    searchParams,
  });
}
