import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { type TaxRate, taxRatesQueryKeys, useTaxRates } from "./useTaxRates";

function buildRate(overrides: Partial<TaxRate> & Pick<TaxRate, "code" | "pct">): TaxRate {
  return {
    id: `id-${overrides.code}`,
    isActive: true,
    isDefault: false,
    isGlobal: true,
    label: overrides.code,
    sortOrder: 0,
    ...overrides,
  };
}

const exempt = buildRate({ code: "exento", label: "Exento", pct: 0 });
const reduced = buildRate({ code: "reducida", label: "Reducida", pct: 8 });
const general = buildRate({ code: "general", isDefault: true, label: "General", pct: 16 });
const oldGeneral = buildRate({ code: "general-12", isActive: false, label: "General 2007", pct: 12 });
const newGeneral = buildRate({ code: "general-12b", label: "General nueva", pct: 12 });

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { queryClient, Wrapper };
}

function RateCount({ testId }: { testId: string }) {
  const { rates } = useTaxRates();

  return <span data-testid={testId}>{rates.length}</span>;
}

describe("useTaxRates", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("pide solo las alícuotas activas por defecto y expone la de la tienda", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [exempt, reduced, general] } }));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaxRates(), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.rates).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/tax-rates?active=true");
    expect(result.current.rates.map((rate) => rate.code)).toEqual(["exento", "reducida", "general"]);
    expect(result.current.defaultRate).toEqual(general);
    expect(result.current.error).toBeNull();
  });

  it("con activeOnly=false pide el catálogo completo en otra entrada de caché", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [general, oldGeneral] } }));
    const { queryClient, Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaxRates({ activeOnly: false }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.rates).toHaveLength(2));

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/tax-rates");
    expect(queryClient.getQueryData(taxRatesQueryKeys.list(false))).toEqual({
      items: [general, oldGeneral],
    });
    expect(queryClient.getQueryData(taxRatesQueryKeys.list(true))).toBeUndefined();
  });

  it("cachea: dos componentes montados hacen una sola petición", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { items: [exempt, general] } }));
    const { Wrapper } = createWrapper();

    const { rerender } = render(
      <Wrapper>
        <RateCount testId="a" />
        <RateCount testId="b" />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("2"));
    expect(screen.getByTestId("b")).toHaveTextContent("2");

    // Un tercer consumidor montado después reutiliza la caché (staleTime largo).
    rerender(
      <Wrapper>
        <RateCount testId="a" />
        <RateCount testId="b" />
        <RateCount testId="c" />
      </Wrapper>,
    );

    expect(screen.getByTestId("c")).toHaveTextContent("2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("vuelve a pedir el catálogo al invalidar la clave exportada", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { items: [general] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [general, reduced] } }));
    const { queryClient, Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaxRates(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.rates).toHaveLength(1));
    await queryClient.invalidateQueries({ queryKey: taxRatesQueryKeys.all });
    await waitFor(() => expect(result.current.rates).toHaveLength(2));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("busca por código y por porcentaje, prefiriendo la activa", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { items: [exempt, general, oldGeneral, newGeneral] } }),
    );
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaxRates({ activeOnly: false }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.rates).toHaveLength(4));

    expect(result.current.byCode("general")).toEqual(general);
    expect(result.current.byCode("no-existe")).toBeNull();
    expect(result.current.byCode(null)).toBeNull();
    expect(result.current.byPct(0)).toEqual(exempt);
    expect(result.current.byPct(16)).toEqual(general);
    expect(result.current.byPct(12)).toEqual(newGeneral);
    expect(result.current.byPct(99)).toBeNull();
  });

  it("sin alícuota por defecto devuelve defaultRate null", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [exempt, reduced] } }));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaxRates(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.rates).toHaveLength(2));

    expect(result.current.defaultRate).toBeNull();
  });

  it("expone el error de la API y permite reintentar", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { items: [general] } }));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useTaxRates(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toBe("No tienes permiso.");
    expect(result.current.rates).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    await result.current.refetch();
    await waitFor(() => expect(result.current.rates).toHaveLength(1));

    expect(result.current.error).toBeNull();
  });
});
