import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getContactsService } from "@/modules/contacts/services";

export async function GET(request: Request, context: RouteContext<"/api/contacts/[id]/payments">) {
  try {
    await requirePermission(request, "contacts.view");
    const { id } = await context.params;
    return jsonData(await getContactsService().getContactPayments(id, new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}
