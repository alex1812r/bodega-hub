import { RETURN_TO_PARAM, isSafeInternalPath, withReturnTo } from "@/shared/utils/returnTo";

/**
 * `returnTo` de la URL (valor ya decodificado) entero, con el `returnTo` que
 * lleve anidado, si es una ruta interna segura (`isSafeInternalPath` valida
 * también el anidado); si no, `null`.
 *
 * Para la cadena `/products → /inventory → /inventory/movements`: "Volver" del
 * kardex regresa a `/inventory` con el `returnTo` con el que se llegó a ella.
 */
export function readChainedReturnTo(returnTo: string | null | undefined): string | null {
  return isSafeInternalPath(returnTo) ? returnTo : null;
}

/**
 * Como `withReturnTo`, pero conserva el `returnTo` que traiga `currentUrl`
 * (ruta + query de la lista, sin `#`): el destino sabe volver a la lista y la
 * lista sigue sabiendo volver a su origen. `href` no lleva `#`. Si `currentUrl`
 * no es segura con su `returnTo` anidado, se comporta como `withReturnTo` (que
 * descarta el anidado, o deja `href` igual).
 */
export function withChainedReturnTo(href: string, currentUrl: string | null | undefined): string {
  if (!isSafeInternalPath(currentUrl)) {
    return withReturnTo(href, currentUrl);
  }

  const queryIndex = href.indexOf("?");
  const path = queryIndex === -1 ? href : href.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : href.slice(queryIndex + 1));

  params.set(RETURN_TO_PARAM, currentUrl);

  return `${path}?${params.toString()}`;
}
