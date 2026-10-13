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

/**
 * GoTrue responde 409 `conflict` al refresh cuando varias peticiones en paralelo
 * refrescan a la vez la misma sesion. El refresh token sigue siendo valido, pero
 * auth-js toma cualquier 4xx del refresh por un rechazo de la credencial y borra
 * la cookie de sesion. Como 503, auth-js lo trata como fallo transitorio:
 * reintenta el refresh con espera y conserva la sesion.
 */
async function fetchWithRetryableRefreshConflict(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const url = input instanceof Request ? input.url : String(input);

  if (response.status !== 409 || !url.includes("/token?grant_type=refresh_token")) {
    return response;
  }

  return new Response(response.body, { headers: response.headers, status: 503 });
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
    global: { fetch: fetchWithRetryableRefreshConflict },
  });
}
