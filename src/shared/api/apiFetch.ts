import {
  getStoredDemoRole,
  getStoredDemoStoreId,
  getStoredDemoUserId,
} from "@/shared/auth/demoAuth";

function isDemoAuthEnabledOnClient() {
  return process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "true";
}

export type ApiErrorPayload = {
  code: string;
  issues?: unknown;
  message: string;
};

type ApiSuccessPayload<TData> = {
  data: TData;
};

type ApiErrorResponse = {
  error: ApiErrorPayload;
};

type ApiFetchOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | object | null;
  query?: Record<string, boolean | null | number | string | undefined>;
};

type MutableHeaders = Headers | Record<string, string>;

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

function buildUrl(path: string, query?: ApiFetchOptions["query"]) {
  const url = new URL(path, "http://localhost");

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return `${url.pathname}${url.search}`;
}

async function readJson<TPayload>(response: Response): Promise<TPayload | null> {
  const contentType = response.headers.get("content-type");

  if (!contentType?.includes("application/json")) {
    return null;
  }

  return (await response.json()) as TPayload;
}

function createMutableHeaders(headers?: HeadersInit): MutableHeaders {
  if (typeof Headers !== "undefined") {
    return new Headers(headers);
  }

  if (!headers) {
    return {};
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers as Record<string, string>;
}

function setHeader(headers: MutableHeaders, key: string, value: string) {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.set(key, value);
    return;
  }

  (headers as Record<string, string>)[key] = value;
}

function getHeader(headers: MutableHeaders, key: string) {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(key);
  }

  return (headers as Record<string, string>)[key];
}

function applyDemoAuthHeaders(headers: MutableHeaders) {
  if (!isDemoAuthEnabledOnClient()) {
    return;
  }

  const role = getStoredDemoRole();
  const userId = getStoredDemoUserId();
  const storeId = getStoredDemoStoreId();

  if (role && !getHeader(headers, "x-demo-role")) {
    setHeader(headers, "x-demo-role", role);
  }

  if (userId && !getHeader(headers, "x-demo-user-id")) {
    setHeader(headers, "x-demo-user-id", userId);
  }

  if (storeId && !getHeader(headers, "x-demo-store-id")) {
    setHeader(headers, "x-demo-store-id", storeId);
  }
}

export async function apiFetch<TData>(
  path: string,
  { body, headers, query, ...init }: ApiFetchOptions = {},
) {
  const requestHeaders = createMutableHeaders(headers);
  let requestBody = body as BodyInit | null | undefined;

  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;

  if (body && typeof body === "object" && !isFormData) {
    setHeader(requestHeaders, "content-type", "application/json");
    requestBody = JSON.stringify(body);
  }

  applyDemoAuthHeaders(requestHeaders);

  const response = await fetch(buildUrl(path, query), {
    ...init,
    body: requestBody,
    headers: requestHeaders,
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await readJson<ApiErrorResponse>(response)
      : null;
    const error = payload?.error;

    const isHtmlNotFound =
      response.status === 404 &&
      !contentType.includes("application/json") &&
      !error;

    throw new ClientApiError(
      response.status,
      error?.code ?? (isHtmlNotFound ? "NOT_FOUND" : "UNKNOWN_ERROR"),
      error?.message ??
        (isHtmlNotFound
          ? `El endpoint ${path} no esta disponible (HTML 404). Para Turbopack: para el dev server, borra la carpeta .next y vuelve a ejecutar npm run dev.`
          : "No se pudo completar la solicitud."),
      error?.issues,
    );
  }

  const payload = await readJson<ApiSuccessPayload<TData>>(response);

  return payload?.data as TData;
}
