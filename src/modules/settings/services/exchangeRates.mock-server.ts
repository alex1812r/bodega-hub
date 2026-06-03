import { paginateList } from "@/lib/api/pagination";
import { DOLAR_API_OFFICIAL_SOURCE } from "@/lib/exchange-rates/constants";
import { mockExchangeRates, type ExchangeRateMock } from "@/shared/mocks/erp-data";

/** Mock: no llama a DolarAPI; devuelve tasa fija para tests y API_DATA_SOURCE=mock. */

export function listExchangeRates(searchParams = new URLSearchParams()) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const items = mockExchangeRates.filter((rate) => {
    const date = rate.createdAt.slice(0, 10);

    return (!from || date >= from) && (!to || date <= to);
  });

  return paginateList(items, searchParams);
}

export function getCurrentExchangeRate() {
  const latest = [...mockExchangeRates].sort(
    (first, second) =>
      new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
  )[0];

  return {
    ...latest,
    source: DOLAR_API_OFFICIAL_SOURCE,
  } satisfies ExchangeRateMock;
}

export function createExchangeRate(input: { rateVes: number; source?: string }) {
  return {
    createdAt: new Date().toISOString(),
    id: `rate-mock-${Date.now()}`,
    rateVes: input.rateVes,
    source: input.source ?? "Manual",
  } satisfies ExchangeRateMock;
}
