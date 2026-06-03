import { createClient } from "@supabase/supabase-js";

import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";

/**
 * Service-role Supabase client — RESTRICTED USE ONLY.
 *
 * Permitted: Auth admin operations (create/disable users), controlled tasks
 * that require bypassing RLS after explicit permission checks in the handler.
 *
 * Never import from client components. Do not use for normal business reads/writes
 * (sales, purchases, inventory, etc.) — those must use the user JWT via route-client.
 */
export function createAdminSupabaseClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
