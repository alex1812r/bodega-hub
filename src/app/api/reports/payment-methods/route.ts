import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getPaymentMethodsReport as getPaymentMethodsReportMock } from "@/modules/reports/services/paymentMethodsReport.mock-server";
import { getPaymentMethodsReport as getPaymentMethodsReportServer } from "@/modules/reports/services/paymentMethodsReport.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getPaymentMethodsReportServer(searchParams, [auth.storeId])
        : getPaymentMethodsReportMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
