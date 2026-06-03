import type { ExchangeRateMock } from "@/shared/mocks/erp-data";

import { DEFAULT_DOLAR_API_CACHE_TTL_MS } from "./constants";

type CacheEntry = {
  expiresAt: number;
  value: ExchangeRateMock;
};

let cache: CacheEntry | null = null;

function getCacheTtlMs() {
  const raw = process.env.DOLAR_API_CACHE_TTL_MS;

  if (!raw) {
    return DEFAULT_DOLAR_API_CACHE_TTL_MS;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DOLAR_API_CACHE_TTL_MS;
}

export function getCachedOfficialRate(): ExchangeRateMock | null {
  if (!cache || cache.expiresAt <= Date.now()) {
    cache = null;
    return null;
  }

  return cache.value;
}

export function setCachedOfficialRate(rate: ExchangeRateMock) {
  cache = {
    expiresAt: Date.now() + getCacheTtlMs(),
    value: rate,
  };
}

export function clearOfficialRateCache() {
  cache = null;
}
