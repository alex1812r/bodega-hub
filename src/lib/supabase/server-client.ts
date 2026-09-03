import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getBearerToken } from "@/lib/supabase/bearer";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function createServerSupabaseClient() {
  const bearerToken = await getBearerToken();

  if (bearerToken) {
    return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Sin cookies: el cliente movil renueva su token por su cuenta.
        },
      },
      global: {
        headers: { Authorization: `Bearer ${bearerToken}` },
      },
    });
  }

  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Route handlers or Server Components may be read-only.
        }
      },
    },
  });
}
