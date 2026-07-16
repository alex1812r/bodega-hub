import { paginateList } from "@/lib/api/pagination";
import { DOLAR_API_OFFICIAL_SOURCE } from "@/lib/exchange-rates/constants";
import { mockExchangeRates, type ExchangeRateMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

/** Mock: no llama a DolarAPI; devuelve tasa fija para tests y API_DATA_SOURCE=mock. */

export function listExchangeRates(searchParams = new URLSearchParams(), storeId = DEFAULT_STORE_ID) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const items = mockExchangeRates.filter((rate) => {
    const date = rate.createdAt.slice(0, 10);

    return (
      (rate.storeId ?? DEFAULT_STORE_ID) === storeId &&
      (!from || date >= from) &&
      (!to || date <= to)
    );
  });

  return paginateList(items, searchParams);
}

export function getCurrentExchangeRate(storeId: string) {
  const latest = [...mockExchangeRates]
    .filter((rate) => (rate.storeId ?? DEFAULT_STORE_ID) === storeId)
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
    )[0];

  return {
    ...latest,
    source: DOLAR_API_OFFICIAL_SOURCE,
    storeId,
  } satisfies ExchangeRateMock;
}

export function createExchangeRate(
  input: { rateVes: number; source?: string },
  storeId: string,
) {
  return {
    createdAt: new Date().toISOString(),
    id: `rate-mock-${Date.now()}`,
    rateVes: input.rateVes,
    source: input.source ?? "Manual",
    storeId,
  } satisfies ExchangeRateMock;
}
