import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ToastProvider } from "@/shared/components/Toast";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import type { AppSettingsMock } from "@/shared/mocks/erp-data";

/** Utilidades de los tests de UI de Configuración (PRO-09). Solo para jest. */

export type ApiCall = { body: unknown; method: string; url: string };

type ApiReply = { payload: unknown; status?: number };
type ApiHandler = (call: ApiCall) => ApiReply | Promise<ApiReply> | undefined;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

/** Respuesta de error del BFF: `{ error: { code, message } }`. */
export function apiError(message: string, status = 400): ApiReply {
  return { payload: { error: { code: "BAD_REQUEST", message } }, status };
}

export function apiData(data: unknown, status = 200): ApiReply {
  return { payload: { data }, status };
}

/**
 * `fetch` de prueba: cada petición pasa por `handler`; si no la atiende
 * (`undefined`) responde 404. Todas quedan en `calls`.
 */
export function installApi(handler: ApiHandler) {
  const calls: ApiCall[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: ApiCall = {
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      method: init?.method ?? "GET",
      url: String(input),
    };

    calls.push(call);

    const reply = (await handler(call)) ?? apiError(`Sin respuesta para ${call.url}`, 404);

    return jsonResponse(reply.payload, reply.status);
  }) as unknown as typeof fetch;

  return {
    calls,
    /** Peticiones que escriben (todo lo que no es GET), en orden. */
    writes: () => calls.filter((call) => call.method !== "GET"),
  };
}

export function createSettingsWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  };
}

export function buildSettings(overrides: Partial<AppSettingsMock> = {}): AppSettingsMock {
  return {
    businessName: "Bodega de prueba",
    defaultTaxRate: 16,
    defaultTaxRateId: "tax-general",
    enabledPaymentMethods: ["efectivo_ves", "pago_movil"],
    invoicePrefix: "V",
    lowStockThreshold: 5,
    pricing: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 },
    ...overrides,
  };
}

export function buildRate(overrides: Partial<TaxRate> & Pick<TaxRate, "code" | "pct">): TaxRate {
  return {
    id: `tax-${overrides.code}`,
    isActive: true,
    isDefault: false,
    isGlobal: true,
    label: overrides.code,
    sortOrder: 0,
    ...overrides,
  };
}
