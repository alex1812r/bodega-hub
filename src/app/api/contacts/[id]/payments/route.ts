import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getContactsService } from "@/modules/contacts/services";
import { assertCanAccessContact } from "@/shared/auth/contactAccess";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";

export async function GET(request: Request, context: RouteContext<"/api/contacts/[id]/payments">) {
  try {
    const auth = await requireStorePermission(request, "contacts.view");
    const { id } = await context.params;
    const contact = await getContactsService().getContactById(id, auth.storeId);
    assertCanAccessContact(auth.role, contact);
    return jsonData(
      await getContactsService().getContactPayments(
        id,
        new URL(request.url).searchParams,
        auth.storeId,
        { salePaymentsOnly: !canViewPurchasePayments(auth.role) },
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
