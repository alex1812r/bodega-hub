import { isSafeInternalPath } from "@/shared/utils/returnTo";

export const LOGIN_PATH = "/login";
/** Parámetro de `/login` con la ruta interna a la que volver tras entrar. */
export const LOGIN_NEXT_PARAM = "next";
/**
 * Tiempo tras el que se permite otra redirección al login. La navegación es de
 * documento: si sigue viva pasado este plazo, el usuario la canceló en el aviso
 * nativo de un proceso sin guardar o volvió atrás desde el login (bfcache).
 */
const REDIRECT_RETRY_MS = 5000;
/** Pantallas públicas: un 401 ahí no significa "sesión caducada". */
const PUBLIC_PATH_PREFIXES = ["/api-docs", "/dev/"];

function isLoginPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0];

  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

/**
 * `true` si `path` (ruta + query) puede ser el destino tras iniciar sesión:
 * ruta interna segura (`isSafeInternalPath`, la misma regla de `returnTo`) que
 * no es el propio login.
 */
export function isLoginNextPath(path: unknown): path is string {
  return isSafeInternalPath(path) && !isLoginPath(path);
}

/**
 * URL del login que conserva la pantalla actual: `/login?next=<ruta + query>`.
 * Si `currentPath` no es un destino válido (`isLoginNextPath`) devuelve
 * `/login` sin `next`.
 */
export function buildLoginUrl(currentPath: string | null | undefined): string {
  if (!isLoginNextPath(currentPath)) {
    return LOGIN_PATH;
  }

  try {
    return `${LOGIN_PATH}?${LOGIN_NEXT_PARAM}=${encodeURIComponent(currentPath)}`;
  } catch {
    // `encodeURIComponent` lanza `URIError` con un surrogate suelto.
    return LOGIN_PATH;
  }
}

/** Destino tras iniciar sesión: `next` de la URL si es válido; si no, `fallback`. */
export function resolveLoginNextPath(next: unknown, fallback: string): string {
  return isLoginNextPath(next) ? next : fallback;
}

/**
 * Navegación de documento al login. Objeto para que los tests la sustituyan:
 * jsdom no implementa `window.location.assign`.
 */
export const loginNavigation = {
  assign(url: string) {
    window.location.assign(url);
  },
};

let isRedirecting = false;

/**
 * Lleva al login por sesión caducada conservando la pantalla actual en `next`.
 * La llaman `apiFetch` (cualquier 401 de una petición autenticada) y el shell;
 * una sola navegación aunque fallen varias peticiones a la vez. No hace nada en
 * el servidor, en `/login` ni en las pantallas públicas de desarrollo.
 *
 * No toca borradores ni caché: la navegación de documento dispara
 * `beforeunload`, donde `useProcessGuard` guarda el borrador del proceso en curso.
 *
 * @returns `true` si esta llamada inició la navegación.
 */
export function redirectToLoginOnSessionExpired(): boolean {
  if (typeof window === "undefined" || isRedirecting) {
    return false;
  }

  const { pathname, search } = window.location;

  if (isLoginPath(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

  isRedirecting = true;
  window.setTimeout(() => {
    isRedirecting = false;
  }, REDIRECT_RETRY_MS);
  loginNavigation.assign(buildLoginUrl(`${pathname}${search}`));

  return true;
}
