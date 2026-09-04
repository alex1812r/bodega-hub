import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getBearerToken } from "@/lib/supabase/bearer";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * Cliente sin cookies, autenticado con el token del header.
 *
 * PostgREST y RLS leen el `Authorization`, asi que los servicios funcionan
 * igual que con sesion por cookie. `getUser()` **no** lo usa: hay que pasarle
 * el token explicitamente (ver `getAuthProfileFromSession`).
 */
function createBearerSupabaseClient(token: string) {
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
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}

export async function createRouteSupabaseClient() {
  const bearerToken = await getBearerToken();

  if (bearerToken) {
    return createBearerSupabaseClient(bearerToken);
  }

  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}
