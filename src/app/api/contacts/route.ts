import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getContactsService } from "@/modules/contacts/services";

const contactSchema = z.object({
  address: z.string().optional(),
  email: z.email().optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  type: z.enum(["cliente", "proveedor", "ambos"]).default("cliente"),
});

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "contacts.view");
    return jsonData(await getContactsService().listContacts(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "contacts.manage");
    const input = contactSchema.parse(await request.json());
    return jsonCreated(await getContactsService().createContact(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
