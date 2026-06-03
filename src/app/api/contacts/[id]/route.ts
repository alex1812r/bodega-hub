import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getContactsService } from "@/modules/contacts/services";

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
    await requirePermission(request, "contacts.view");
    const { id } = await context.params;
    return jsonData(await getContactsService().getContactById(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/contacts/[id]">) {
  try {
    await requirePermission(request, "contacts.manage");
    const { id } = await context.params;
    const input = updateContactSchema.parse(await request.json());
    return jsonData(await getContactsService().updateContact(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
