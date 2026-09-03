import { getApiBaseUrl, isDemoAuthEnabled, requestTimeoutMs } from "./config";

/** Mismo contrato de error que `src/shared/api/apiFetch.ts` en la web. */
export type ApiErrorPayload = {
  code: string;
  issues?: unknown;
  message: string;
};

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }
}

/** Fallo de red o timeout: no sabemos si el servidor llego a procesar. */
export class NetworkError extends Error {
  constructor(message = "No hay conexion con el servidor.") {
    super(message);
    this.name = "NetworkError";
  }
}

export type DemoAuthHeaders = {
  role?: string;
  storeId?: string;
  userId?: string;
};

type Query = Record<string, boolean | null | number | string | undefined>;

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | object | null;
  query?: Query;
  /** Token Bearer. Lo inyecta `createApiClient`; rara vez se pasa a mano. */
  accessToken?: string | null;
  demoAuth?: DemoAuthHeaders | null;
  signal?: AbortSignal;
};

function buildUrl(path: string, query?: Query) {
  const base = getApiBaseUrl();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function isSafeToRetry(method: string) {
  // Solo GET/HEAD. `POST /api/sales` no es idempotente en el backend: un
  // reintento automatico puede duplicar una venta.
  const safe = method.toUpperCase();
  return safe === "GET" || safe === "HEAD";
}

async function readJson<TPayload>(response: Response): Promise<TPayload | null> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as TPayload;
  } catch {
    return null;
  }
}

async function toApiError(response: Response, path: string) {
  const payload = await readJson<{ error?: ApiErrorPayload }>(response);
  const error = payload?.error;

  if (error) {
    return new ApiClientError(response.status, error.code, error.message, error.issues);
  }

  if (response.status === 404) {
    return new ApiClientError(404, "NOT_FOUND", `El endpoint ${path} no esta disponible.`);
  }

  return new ApiClientError(
    response.status,
    "UNKNOWN_ERROR",
    "No se pudo completar la solicitud.",
  );
}

async function runFetch(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export type ApiClientHooks = {
  /** Token actual, o null si no hay sesion. */
  getAccessToken?: () => Promise<string | null> | string | null;
  /** Headers demo para desarrollo sin Supabase. */
  getDemoAuth?: () => DemoAuthHeaders | null;
  /** Llamado ante un 401: la sesion ya no sirve. */
  onUnauthorized?: () => void;
};

export function createApiClient(hooks: ApiClientHooks = {}) {
  return async function apiRequest<TData>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<TData> {
    const { body, headers, query, accessToken, demoAuth, ...init } = options;
    const method = init.method ?? "GET";
    const requestHeaders = new Headers(headers);

    let requestBody = body as BodyInit | null | undefined;
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

    if (body && typeof body === "object" && !isFormData) {
      requestHeaders.set("content-type", "application/json");
      requestBody = JSON.stringify(body);
    }

    const token = accessToken ?? (await hooks.getAccessToken?.()) ?? null;

    if (token) {
      requestHeaders.set("authorization", `Bearer ${token}`);
    }

    if (isDemoAuthEnabled()) {
      const demo = demoAuth ?? hooks.getDemoAuth?.() ?? null;

      if (demo?.role) requestHeaders.set("x-demo-role", demo.role);
      if (demo?.userId) requestHeaders.set("x-demo-user-id", demo.userId);
      if (demo?.storeId) requestHeaders.set("x-demo-store-id", demo.storeId);
    }

    const url = buildUrl(path, query);
    const requestInit: RequestInit = { ...init, body: requestBody, headers: requestHeaders };

    let response: Response;

    try {
      response = await runFetch(url, requestInit, requestTimeoutMs);
    } catch (error) {
      if (isSafeToRetry(method)) {
        try {
          response = await runFetch(url, requestInit, requestTimeoutMs);
        } catch {
          throw new NetworkError();
        }
      } else {
        throw new NetworkError(
          "No se pudo enviar la solicitud. Revisa tu conexion y verifica antes de reintentar.",
        );
      }

      void error;
    }

    if (!response.ok) {
      const apiError = await toApiError(response, path);

      if (apiError.isUnauthorized) {
        hooks.onUnauthorized?.();
      }

      throw apiError;
    }

    const payload = await readJson<{ data: TData }>(response);

    return payload?.data as TData;
  };
}

export type ApiRequest = ReturnType<typeof createApiClient>;
