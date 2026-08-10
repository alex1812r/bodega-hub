import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getContactsService } from "@/modules/contacts/services";
import {
  assertCanAccessContact,
  assertCanWriteContactType,
} from "@/shared/auth/contactAccess";

const updateContactSchema = z.object({
  address: z.string().optional(),
  email: z.email().optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  type: z.enum(["cliente", "proveedor", "ambos"]).optional(),
});

export async function GET(request: Request, context: RouteContext<"/api/contacts/[id]">) {
  try {
    const auth = await requireStorePermission(request, "contacts.view");
    const { id } = await context.params;
    const contact = await getContactsService().getContactById(id, auth.storeId);
    assertCanAccessContact(auth.role, contact);
    return jsonData(contact);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/contacts/[id]">) {
  try {
    const auth = await requireStorePermission(request, "contacts.manage");
    const { id } = await context.params;
    const input = updateContactSchema.parse(await request.json());
    const existing = await getContactsService().getContactById(id, auth.storeId);
    assertCanAccessContact(auth.role, existing);
    assertCanWriteContactType(auth.role, input.type);
    return jsonData(await getContactsService().updateContact(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
