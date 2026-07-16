import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getContactsService } from "@/modules/contacts/services";

export async function GET(request: Request, context: RouteContext<"/api/contacts/[id]/activity">) {
  try {
    const auth = await requireStorePermission(request, "contacts.view");
    const { id } = await context.params;
    return jsonData(await getContactsService().getContactActivity(id, new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
