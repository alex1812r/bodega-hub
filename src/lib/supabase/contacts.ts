import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/apiError";
import { mapSupabaseError } from "@/lib/supabase/errors";
import type { ContactType } from "@/shared/mocks/erp-data";

export async function assertContactType(
  supabase: SupabaseClient,
  contactId: string,
  expectedTypes: ContactType[],
) {
  const { error } = await supabase.rpc("assert_contact_type", {
    p_contact_id: contactId,
    p_expected_types: expectedTypes,
  });

  if (!error) {
    return;
  }

  const message = error.message?.toLowerCase() ?? "";

  if (message.includes("no encontrado")) {
    throw new ApiError(404, "NOT_FOUND", "Contacto no encontrado.");
  }

  if (message.includes("tipo de contacto")) {
    throw new ApiError(400, "BAD_REQUEST", "Tipo de contacto invalido para esta operacion.");
  }

  throw mapSupabaseError(error);
}
