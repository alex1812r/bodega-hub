/**
 * Parámetro de la URL del detalle que guarda la URL de la lista de origen.
 * Nombre reservado: ninguna lista lo usa como filtro. `from` y `to` no sirven
 * porque son los filtros de rango de fechas de ventas, compras, inventario,
 * reportes y dashboard.
 */
export const RETURN_TO_PARAM = "returnTo";
/** Una URL de retorno más larga que esto se descarta. */
export const MAX_RETURN_TO_LENGTH = 2000;

/** Origen ficticio para normalizar rutas relativas con el parser de URL. */
const PARSE_BASE = "http://return-to.invalid";
/**
 * Codificaciones que no deben aparecer en la RUTA de una URL de retorno:
 * `/` y `\` codificados, `.` codificado (segmentos `..` ocultos), `%`
 * codificado (doble codificación) y caracteres de control.
 */
const ENCODED_PATH_HAZARD = /%(?:2f|5c|2e|25|[01][0-9a-f]|7f)/i;
/**
 * Parámetros de la query (en minúsculas) que una pantalla puede usar como
 * destino de una redirección, p. ej. `next` en `/login`. Su valor debe ser a su
 * vez una ruta interna segura. Incluye el parámetro propio (`RETURN_TO_PARAM`):
 * un destino con un `returnTo` anidado inseguro se rechaza entero, y uno seguro
 * lo eliminan después `resolveReturnTo` y `withReturnTo`. `from` no está aquí:
 * es un filtro de fechas, nadie navega a su valor.
 */
const REDIRECT_PARAMS = new Set([
  "next",
  "redirect",
  "redirectto",
  "redirect_to",
  RETURN_TO_PARAM.toLowerCase(),
  "return_to",
  "callbackurl",
]);

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }

  return false;
}

function splitHref(href: string) {
  const hashIndex = href.indexOf("#");
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");

  return {
    hash: hashIndex === -1 ? "" : href.slice(hashIndex),
    path: queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex),
    query: queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1),
  };
}

function isReturnToPair(pair: string) {
  const rawKey = pair.split("=", 1)[0].replace(/\+/g, " ");

  try {
    return decodeURIComponent(rawKey) === RETURN_TO_PARAM;
  } catch {
    return false;
  }
}

/** Pares `clave=valor` de una query tal cual vienen, sin el parámetro `returnTo`. */
function pairsWithoutReturnTo(query: string) {
  return query.split("&").filter((pair) => pair !== "" && !isReturnToPair(pair));
}

/** Quita `returnTo` de una URL relativa sin tocar el resto de sus parámetros. */
function stripReturnTo(url: string) {
  const { hash, path, query } = splitHref(url);
  const pairs = pairsWithoutReturnTo(query);

  return `${path}${pairs.length > 0 ? `?${pairs.join("&")}` : ""}${hash}`;
}

/**
 * `true` solo para una ruta interna de la app a la que es seguro navegar:
 * relativa, empieza por una única `/`, sin `\`, sin caracteres de control, sin
 * codificaciones peligrosas en la ruta, sin segmentos `.`/`..`, acotada en
 * longitud, que no apunta a `/api/` y cuyos parámetros de redirección
 * (`next`, `redirect`…; ver `REDIRECT_PARAMS`) cumplen esta misma regla.
 */
export function isSafeInternalPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RETURN_TO_LENGTH ||
    value[0] !== "/" ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    return false;
  }

  const { path } = splitHref(value);

  if (
    path.includes("//") ||
    ENCODED_PATH_HAZARD.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return false;
  }

  const pathname = url.pathname.toLowerCase();

  if (url.origin !== PARSE_BASE || pathname === "/api" || pathname.startsWith("/api/")) {
    return false;
  }

  for (const [key, nested] of url.searchParams) {
    if (REDIRECT_PARAMS.has(key.toLowerCase()) && !isSafeInternalPath(nested)) {
      return false;
    }
  }

  return true;
}

/**
 * `value` si es una ruta interna segura (ver `isSafeInternalPath`); si no,
 * `fallback`. Para destinos que llegan en la URL y se navegan tal cual, p. ej.
 * `next` tras iniciar sesión. A diferencia de `resolveReturnTo`, no quita `returnTo`.
 */
export function safeInternalPath(value: unknown, fallback: string): string {
  return isSafeInternalPath(value) ? value : fallback;
}

/** `encodeURIComponent` lanza `URIError` con un surrogate suelto; aquí es `null`. */
function encodeComponentOrNull(value: string) {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Añade a `href` (enlace de fila a un detalle) el parámetro `returnTo` con la
 * URL de la lista (`currentUrl`: ruta + query, relativa; p. ej. `list.href` de
 * `useUrlListState`). Conserva los parámetros y el `#` de `href`, sustituye un
 * `returnTo` anterior y no encadena: el `returnTo` que traiga la URL de la lista
 * se elimina (desde un subdetalle se vuelve al detalle, sin su lista). Los
 * filtros de la lista, incluido `from`, viajan intactos. Si `currentUrl` no es
 * una ruta interna segura o no se puede codificar (surrogate suelto), devuelve
 * `href` igual.
 */
export function withReturnTo(href: string, currentUrl: string | null | undefined): string {
  if (!currentUrl) {
    return href;
  }

  const current = splitHref(currentUrl);
  const listUrl = stripReturnTo(
    current.query ? `${current.path}?${current.query}` : current.path,
  );

  const encodedListUrl = isSafeInternalPath(listUrl) ? encodeComponentOrNull(listUrl) : null;

  if (encodedListUrl === null) {
    return href;
  }

  const { hash, path, query } = splitHref(href);
  const pairs = [...pairsWithoutReturnTo(query), `${RETURN_TO_PARAM}=${encodedListUrl}`];

  return `${path}?${pairs.join("&")}${hash}`;
}

/**
 * Destino de "Volver": `returnTo` (valor ya decodificado del parámetro de la
 * URL, `searchParams.get(RETURN_TO_PARAM)`) solo si es una ruta interna segura;
 * si no, `fallbackHref`. Un `returnTo` seguro anidado dentro de `returnTo` se
 * descarta; uno inseguro invalida el destino entero.
 */
export function resolveReturnTo(
  returnTo: string | null | undefined,
  fallbackHref: string,
): string {
  if (!isSafeInternalPath(returnTo)) {
    return fallbackHref;
  }

  return stripReturnTo(returnTo);
}

/**
 * `returnTo` de la URL (valor ya decodificado) entero, con el `returnTo` que
 * lleve anidado, si es una ruta interna segura (`isSafeInternalPath` valida
 * también el anidado); si no, `null`.
 *
 * Para cadenas lista → detalle A → detalle B: "Volver" de B regresa a A con el
 * `returnTo` con el que se llegó a A, y desde A se sigue volviendo a la lista
 * con sus filtros. `resolveReturnTo`, en cambio, quita ese anidado.
 */
export function readChainedReturnTo(returnTo: string | null | undefined): string | null {
  return isSafeInternalPath(returnTo) ? returnTo : null;
}

/**
 * Como `withReturnTo`, pero conserva el `returnTo` que traiga `currentUrl`
 * (ruta + query de la pantalla actual, sin `#`): el destino sabe volver a esta
 * pantalla y esta sigue sabiendo volver a su origen. `href` no lleva `#`. Si
 * `currentUrl` no es segura con su `returnTo` anidado, se comporta como
 * `withReturnTo` (que descarta el anidado, o deja `href` igual).
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
