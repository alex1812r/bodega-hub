/** Parámetro de la URL del detalle que guarda la URL de la lista de origen. */
export const RETURN_TO_PARAM = "from";
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

/** Pares `clave=valor` de una query tal cual vienen, sin el parámetro `from`. */
function pairsWithoutReturnTo(query: string) {
  return query.split("&").filter((pair) => pair !== "" && !isReturnToPair(pair));
}

/** Quita `from` de una URL relativa sin tocar el resto de sus parámetros. */
function stripReturnTo(url: string) {
  const { hash, path, query } = splitHref(url);
  const pairs = pairsWithoutReturnTo(query);

  return `${path}${pairs.length > 0 ? `?${pairs.join("&")}` : ""}${hash}`;
}

/**
 * `true` solo para una ruta interna de la app a la que es seguro navegar:
 * relativa, empieza por una única `/`, sin `\`, sin caracteres de control, sin
 * codificaciones peligrosas en la ruta, sin segmentos `.`/`..`, acotada en
 * longitud y que no apunta a `/api/`.
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

  return url.origin === PARSE_BASE && pathname !== "/api" && !pathname.startsWith("/api/");
}

/**
 * Añade a `href` (enlace de fila a un detalle) el parámetro `from` con la URL
 * de la lista (`currentUrl`: ruta + query, relativa; p. ej. `list.href` de
 * `useUrlListState`). Conserva los parámetros y el `#` de `href`, sustituye un
 * `from` anterior y no encadena: el `from` que traiga la URL de la lista se
 * elimina. Si `currentUrl` no es una ruta interna segura, devuelve `href` igual.
 */
export function withReturnTo(href: string, currentUrl: string | null | undefined): string {
  if (!currentUrl) {
    return href;
  }

  const current = splitHref(currentUrl);
  const listUrl = stripReturnTo(
    current.query ? `${current.path}?${current.query}` : current.path,
  );

  if (!isSafeInternalPath(listUrl)) {
    return href;
  }

  const { hash, path, query } = splitHref(href);
  const pairs = [
    ...pairsWithoutReturnTo(query),
    `${RETURN_TO_PARAM}=${encodeURIComponent(listUrl)}`,
  ];

  return `${path}?${pairs.join("&")}${hash}`;
}

/**
 * Destino de "Volver": `from` (valor ya decodificado del parámetro de la URL,
 * p. ej. `searchParams.get("from")`) solo si es una ruta interna segura; si no,
 * `fallbackHref`. Un `from` anidado dentro de `from` se descarta.
 */
export function resolveReturnTo(from: string | null | undefined, fallbackHref: string): string {
  if (!isSafeInternalPath(from)) {
    return fallbackHref;
  }

  return stripReturnTo(from);
}
