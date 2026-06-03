import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

export async function POST() {
  try {
    const supabase = await createRouteSupabaseClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw mapSupabaseError(error);
    }

    return jsonData({ signedOut: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
