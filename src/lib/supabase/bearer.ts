import { headers } from "next/headers";

const bearerPrefix = /^Bearer\s+/i;

/**
 * Token de `Authorization: Bearer <access_token>` de la peticion en curso.
 *
 * La web se autentica por cookies; la app movil (BodegaHub Mobile) manda el
 * access token de Supabase en el header porque no tiene cookie jar compartido.
 * Devuelve `null` cuando no hay header, cuando el esquema no es Bearer o cuando
 * se llama fuera del scope de una peticion (build, tests sin request).
 */
export async function getBearerToken(): Promise<string | null> {
  let headerList: Awaited<ReturnType<typeof headers>>;

  try {
    headerList = await headers();
  } catch {
    return null;
  }

  const authorization = headerList.get("authorization");

  if (!authorization || !bearerPrefix.test(authorization)) {
    return null;
  }

  const token = authorization.replace(bearerPrefix, "").trim();

  return token.length > 0 ? token : null;
}
